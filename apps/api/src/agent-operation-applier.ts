import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { WorkflowGraph, GraphNode, GraphEdge } from "@algoverge/shared";
import { normalizeWorkflowGraph } from "@algoverge/shared";
import { getApp } from "./catalog/catalog";
import { invokeTool } from "./tool-registry";
import { validateWorkflowGraph } from "./workflow-validation";
import { queryOne } from "./db";

const nodePatchSchema = z.object({
  label: z.string().min(1).optional(), appSlug: z.string().min(1).optional(), operation: z.string().min(1).optional(),
  type: z.enum(["trigger", "action", "logic"]).optional(), position: z.object({ x: z.number(), y: z.number() }).optional(),
  config: z.record(z.unknown()).optional(), connectionId: z.string().nullable().optional(),
});

export const AgentOperation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add_node"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("remove_node"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("update_node"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("configure_node"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("connect_nodes"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("disconnect_nodes"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("map_field"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("validate_workflow"), arguments: z.record(z.unknown()).default({}), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("test_action"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("explain_run"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
]);
export type AgentOperation = z.infer<typeof AgentOperation>;

export type ApplyAgentOperationsOptions = { graph: unknown; operations: unknown[]; workspaceId: string; organizationId: string; executionId?: string; allowDestructive?: boolean };
export type ApplyAgentOperationsResult = { graph: WorkflowGraph; applied: AgentOperation[]; rejected: Array<{ operation: AgentOperation | unknown; reason: string }>; needsConfirmation: AgentOperation[]; issues: Array<{ code: string; message: string; nodeId?: string; edgeId?: string }>; testResults: Array<{ nodeId: string; result: unknown }> };

function stringArg(args: Record<string, unknown>, key: string): string | undefined { const value = args[key]; return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function recordArg(args: Record<string, unknown>, key: string): Record<string, unknown> { const value = args[key]; return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function findNode(graph: WorkflowGraph, id: string | undefined) { return id ? graph.nodes.find((node) => node.id === id) : undefined; }
function assertOperation(appSlug: string, operation: string) { const app = getApp(appSlug); if (!app) throw new Error(`Unknown app: ${appSlug}`); const op = app.operations.find((candidate) => candidate.key === operation); if (!op) throw new Error(`Unknown operation: ${appSlug}.${operation}`); return { app, op }; }

function addNode(graph: WorkflowGraph, args: Record<string, unknown>): WorkflowGraph {
  const appSlug = stringArg(args, "appSlug") ?? stringArg(args, "piece"); const operation = stringArg(args, "operation");
  if (!appSlug || !operation) throw new Error("add_node requires appSlug and operation"); const { op } = assertOperation(appSlug, operation);
  const type = op.type === "trigger" ? "trigger" : "action"; if (type === "trigger" && graph.nodes.some((node) => node.type === "trigger")) throw new Error("Workflow already has a trigger");
  const node: GraphNode = { id: stringArg(args, "nodeId") ?? randomUUID(), type, appSlug, operation, label: stringArg(args, "label") ?? op.name, position: { x: typeof args.x === "number" ? args.x : 420, y: typeof args.y === "number" ? args.y : 180 + graph.nodes.length * 140 }, config: recordArg(args, "config"), connectionId: stringArg(args, "connectionId") ?? null };
  if (graph.nodes.some((n) => n.id === node.id)) throw new Error(`Node already exists: ${node.id}`); return { ...graph, nodes: [...graph.nodes, node] };
}
function removeNode(graph: WorkflowGraph, args: Record<string, unknown>): WorkflowGraph { const nodeId = stringArg(args, "nodeId"); if (!nodeId) throw new Error("remove_node requires nodeId"); if (!findNode(graph, nodeId)) throw new Error(`Step not found: ${nodeId}`); return { nodes: graph.nodes.filter((node) => node.id !== nodeId), edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId) }; }
function updateNode(graph: WorkflowGraph, args: Record<string, unknown>): WorkflowGraph { const nodeId = stringArg(args, "nodeId"); const node = findNode(graph, nodeId); if (!node) throw new Error(`Step not found: ${nodeId ?? "unknown"}`); const patch = nodePatchSchema.parse({ label: args.label, appSlug: args.appSlug, operation: args.operation, type: args.type, position: args.position, config: args.config, connectionId: args.connectionId }); const next = { ...node }; const nextApp = patch.appSlug ?? node.appSlug; const nextOperation = patch.operation ?? node.operation; if (patch.appSlug || patch.operation || patch.type) { const { op } = assertOperation(nextApp, nextOperation); next.appSlug = nextApp; next.operation = nextOperation; next.type = patch.type ?? (op.type === "trigger" ? "trigger" : "action"); next.label = patch.label ?? op.name; if (next.type === "trigger" && graph.nodes.some((candidate) => candidate.id !== node.id && candidate.type === "trigger")) throw new Error("Cannot create a second trigger node"); } else if (patch.label) next.label = patch.label; if (patch.position) next.position = patch.position; if (patch.connectionId !== undefined) next.connectionId = patch.connectionId; if (patch.config) next.config = { ...node.config, ...patch.config }; return { ...graph, nodes: graph.nodes.map((candidate) => candidate.id === node.id ? next : candidate) }; }
function connectNodes(graph: WorkflowGraph, args: Record<string, unknown>): WorkflowGraph { const source = stringArg(args, "source") ?? stringArg(args, "sourceNodeId"); const target = stringArg(args, "target") ?? stringArg(args, "targetNodeId"); if (!source || !target) throw new Error("connect_nodes requires source and target"); if (!findNode(graph, source) || !findNode(graph, target)) throw new Error("Both edge endpoints must exist"); if (source === target) throw new Error("A node cannot connect to itself"); if (graph.edges.some((edge) => edge.source === source && edge.target === target && edge.sourceHandle === (stringArg(args, "sourceHandle") ?? null))) return graph; const edge: GraphEdge = { id: stringArg(args, "edgeId") ?? randomUUID(), source, target, sourceHandle: stringArg(args, "sourceHandle") ?? null, condition: args.condition && typeof args.condition === "object" ? recordArg(args, "condition") : null }; return { ...graph, edges: [...graph.edges, edge] }; }
function disconnectNodes(graph: WorkflowGraph, args: Record<string, unknown>): WorkflowGraph { const source = stringArg(args, "source") ?? stringArg(args, "sourceNodeId"); const target = stringArg(args, "target") ?? stringArg(args, "targetNodeId"); if (!source || !target) throw new Error("disconnect_nodes requires source and target"); return { ...graph, edges: graph.edges.filter((edge) => !(edge.source === source && edge.target === target)) }; }
function mapField(graph: WorkflowGraph, args: Record<string, unknown>): WorkflowGraph { const nodeId = stringArg(args, "nodeId"); const field = stringArg(args, "field"); if (!nodeId || !field) throw new Error("map_field requires nodeId and field"); const node = findNode(graph, nodeId); if (!node) throw new Error(`Step not found: ${nodeId}`); return { ...graph, nodes: graph.nodes.map((candidate) => candidate.id === nodeId ? { ...candidate, config: { ...candidate.config, [field]: args.value } } : candidate) }; }
async function executeTestAction(opts: ApplyAgentOperationsOptions, graph: WorkflowGraph, args: Record<string, unknown>) { const nodeId = stringArg(args, "nodeId"); const node = findNode(graph, nodeId); if (!node) throw new Error(`Step not found: ${nodeId ?? "unknown"}`); if (node.type === "trigger" || !node.operation) throw new Error("test_action requires an executable action step"); const executionId = opts.executionId ?? randomUUID(); return { nodeId: node.id, result: await invokeTool({ piece: node.appSlug, operation: node.operation, connectionId: node.connectionId, props: node.config ?? {}, workspaceId: opts.workspaceId, organizationId: opts.organizationId, executionId, idempotencyKey: `${executionId}:${node.id}:agent-test`, allowDestructive: opts.allowDestructive === true, source: "agent" }) }; }

// Destructive or externally-visible operations are confirmation-gated regardless of UI mode.
function requiresConfirmation(operation: AgentOperation): boolean { return operation.requires_confirmation === true || operation.kind === "remove_node" || operation.kind === "disconnect_nodes" || operation.kind === "test_action"; }

export async function applyAgentOperations(opts: ApplyAgentOperationsOptions): Promise<ApplyAgentOperationsResult> {
  let graph = normalizeWorkflowGraph(opts.graph); const applied: AgentOperation[] = []; const rejected: Array<{ operation: AgentOperation | unknown; reason: string }> = []; const needsConfirmation: AgentOperation[] = []; const testResults: Array<{ nodeId: string; result: unknown }> = [];
  for (const rawOperation of opts.operations) {
    const parsed = AgentOperation.safeParse(rawOperation); if (!parsed.success) { rejected.push({ operation: rawOperation, reason: `Invalid AgentOperation: ${parsed.error.message}` }); continue; }
    const operation = parsed.data;
    try {
      if (requiresConfirmation(operation) && !opts.allowDestructive) { needsConfirmation.push(operation); continue; }
      switch (operation.kind) {
        case "add_node": graph = addNode(graph, operation.arguments); break;
        case "remove_node": graph = removeNode(graph, operation.arguments); break;
        case "update_node": case "configure_node": graph = updateNode(graph, operation.arguments); break;
        case "connect_nodes": graph = connectNodes(graph, operation.arguments); break;
        case "disconnect_nodes": graph = disconnectNodes(graph, operation.arguments); break;
        case "map_field": graph = mapField(graph, operation.arguments); break;
        case "validate_workflow": break;
        case "test_action": testResults.push(await executeTestAction(opts, graph, operation.arguments)); break;
        case "explain_run": { const runId = stringArg(operation.arguments, "runId"); if (!runId) throw new Error("explain_run requires runId"); const run = await queryOne<{ status: string; context: unknown }>(`SELECT status, context FROM flow_runs WHERE id = $1 AND org_id = $2`, [runId, opts.workspaceId]); if (!run) throw new Error("Run not found in this workspace"); break; }
      }
      applied.push(operation);
    } catch (error) { rejected.push({ operation, reason: error instanceof Error ? error.message : "operation_failed" }); }
  }
  const validation = await validateWorkflowGraph(graph, { workspaceId: opts.workspaceId, strict: false });
  return { graph: validation.graph, applied, rejected, needsConfirmation, issues: validation.issues, testResults };
}
