import { randomUUID } from "node:crypto";
import type { WorkflowGraph, GraphNode, GraphEdge } from "@algoverge/shared";
import { normalizeWorkflowGraph } from "@algoverge/shared";
import { getApp } from "./catalog";
import { invokeTool } from "./tool-registry";
import { validateWorkflowGraph } from "./workflow-validation";
import { queryOne } from "./db";

export type AgentOperation = {
  kind: string;
  arguments: Record<string, unknown>;
  requires_confirmation?: boolean;
};

export type ApplyAgentOperationsOptions = {
  graph: unknown;
  operations: AgentOperation[];
  workspaceId: string;
  organizationId: string;
  executionId?: string;
  allowDestructive?: boolean;
};

export type ApplyAgentOperationsResult = {
  graph: WorkflowGraph;
  applied: AgentOperation[];
  rejected: Array<{ operation: AgentOperation; reason: string }>;
  needsConfirmation: AgentOperation[];
  issues: Array<{ code: string; message: string; nodeId?: string; edgeId?: string }>;
};

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordArg(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function findNode(graph: WorkflowGraph, id: string | undefined) {
  return id ? graph.nodes.find((node) => node.id === id) : undefined;
}

function assertOperation(appSlug: string, operation: string) {
  const app = getApp(appSlug);
  if (!app) throw new Error(`Unknown app: ${appSlug}`);
  const op = app.operations.find((candidate) => candidate.key === operation);
  if (!op) throw new Error(`Unknown operation: ${appSlug}.${operation}`);
  return { app, op };
}

function addNode(graph: WorkflowGraph, args: Record<string, unknown>): WorkflowGraph {
  const appSlug = stringArg(args, "appSlug") ?? stringArg(args, "piece");
  const operation = stringArg(args, "operation");
  if (!appSlug || !operation) throw new Error("add_node requires appSlug and operation");
  const { op } = assertOperation(appSlug, operation);
  const type = op.type === "trigger" ? "trigger" : "action";
  if (type === "trigger" && graph.nodes.some((node) => node.type === "trigger")) {
    throw new Error("Workflow already has a trigger");
  }
  const node: GraphNode = {
    id: stringArg(args, "nodeId") ?? randomUUID(),
    type,
    appSlug,
    operation,
    label: stringArg(args, "label") ?? op.name,
    position: {
      x: typeof args.x === "number" ? args.x : 420,
      y: typeof args.y === "number" ? args.y : 180 + graph.nodes.length * 140,
    },
    config: recordArg(args, "config"),
    connectionId: stringArg(args, "connectionId") ?? null,
  };
  return { ...graph, nodes: [...graph.nodes, node] };
}

function removeNode(graph: WorkflowGraph, args: Record<string, unknown>): WorkflowGraph {
  const nodeId = stringArg(args, "nodeId");
  if (!nodeId) throw new Error("remove_node requires nodeId");
  if (!findNode(graph, nodeId)) throw new Error(`Step not found: ${nodeId}`);
  return {
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  };
}

function updateNode(graph: WorkflowGraph, args: Record<string, unknown>): WorkflowGraph {
  const nodeId = stringArg(args, "nodeId");
  const node = findNode(graph, nodeId);
  if (!node) throw new Error(`Step not found: ${nodeId ?? "unknown"}`);
  const next = { ...node };
  const appSlug = stringArg(args, "appSlug");
  const operation = stringArg(args, "operation");
  if (appSlug || operation) {
    const nextApp = appSlug ?? node.appSlug;
    const nextOperation = operation ?? node.operation;
    const { op } = assertOperation(nextApp, nextOperation);
    next.appSlug = nextApp;
    next.operation = nextOperation;
    next.type = op.type === "trigger" ? "trigger" : "action";
    next.label = stringArg(args, "label") ?? op.name;
  } else if (stringArg(args, "label")) {
    next.label = stringArg(args, "label")!;
  }
  if (stringArg(args, "connectionId")) next.connectionId = stringArg(args, "connectionId");
  if (args.connectionId === null) next.connectionId = null;
  if (args.config && typeof args.config === "object") next.config = { ...node.config, ...recordArg(args, "config") };
  return { ...graph, nodes: graph.nodes.map((candidate) => candidate.id === node.id ? next : candidate) };
}

function connectNodes(graph: WorkflowGraph, args: Record<string, unknown>): WorkflowGraph {
  const source = stringArg(args, "source") ?? stringArg(args, "sourceNodeId");
  const target = stringArg(args, "target") ?? stringArg(args, "targetNodeId");
  if (!source || !target) throw new Error("connect_nodes requires source and target");
  if (!findNode(graph, source) || !findNode(graph, target)) throw new Error("Both edge endpoints must exist");
  if (source === target) throw new Error("A node cannot connect to itself");
  if (graph.edges.some((edge) => edge.source === source && edge.target === target)) return graph;
  const edge: GraphEdge = {
    id: stringArg(args, "edgeId") ?? randomUUID(),
    source,
    target,
    sourceHandle: stringArg(args, "sourceHandle") ?? null,
    condition: args.condition && typeof args.condition === "object" ? recordArg(args, "condition") : null,
  };
  return { ...graph, edges: [...graph.edges, edge] };
}

async function executeTestAction(opts: ApplyAgentOperationsOptions, graph: WorkflowGraph, args: Record<string, unknown>) {
  const nodeId = stringArg(args, "nodeId");
  const node = findNode(graph, nodeId);
  if (!node) throw new Error(`Step not found: ${nodeId ?? "unknown"}`);
  if (node.type === "trigger" || !node.operation) throw new Error("test_action requires an executable action step");
  const executionId = opts.executionId ?? randomUUID();
  const result = await invokeTool({
    piece: node.appSlug,
    operation: node.operation,
    connectionId: node.connectionId,
    props: node.config ?? {},
    workspaceId: opts.workspaceId,
    organizationId: opts.organizationId,
    executionId,
    idempotencyKey: `${executionId}:${node.id}:agent-test`,
    allowDestructive: opts.allowDestructive === true,
    source: "agent",
  });
  return { nodeId: node.id, result };
}

export async function applyAgentOperations(opts: ApplyAgentOperationsOptions): Promise<ApplyAgentOperationsResult> {
  let graph = normalizeWorkflowGraph(opts.graph);
  const applied: AgentOperation[] = [];
  const rejected: Array<{ operation: AgentOperation; reason: string }> = [];
  const needsConfirmation: AgentOperation[] = [];

  for (const operation of opts.operations) {
    try {
      if (operation.requires_confirmation && !opts.allowDestructive) {
        needsConfirmation.push(operation);
        continue;
      }
      switch (operation.kind) {
        case "add_node":
          graph = addNode(graph, operation.arguments);
          break;
        case "remove_node":
          graph = removeNode(graph, operation.arguments);
          break;
        case "update_node":
        case "configure_node":
          graph = updateNode(graph, operation.arguments);
          break;
        case "connect_nodes":
          graph = connectNodes(graph, operation.arguments);
          break;
        case "validate_workflow":
          break;
        case "test_action":
          await executeTestAction(opts, graph, operation.arguments);
          break;
        case "explain_run": {
          const runId = stringArg(operation.arguments, "runId");
          if (!runId) throw new Error("explain_run requires runId");
          const run = await queryOne<{ status: string; context: unknown }>(
            `SELECT status, context FROM flow_runs WHERE id = $1 AND org_id = $2`,
            [runId, opts.workspaceId],
          );
          if (!run) throw new Error("Run not found in this workspace");
          break;
        }
        default:
          throw new Error(`Unsupported agent operation: ${operation.kind}`);
      }
      applied.push(operation);
    } catch (error) {
      rejected.push({
        operation,
        reason: error instanceof Error ? error.message : "operation_failed",
      });
    }
  }

  const validation = await validateWorkflowGraph(graph, { workspaceId: opts.workspaceId, strict: false });
  return {
    graph: validation.graph,
    applied,
    rejected,
    needsConfirmation,
    issues: validation.issues,
  };
}
