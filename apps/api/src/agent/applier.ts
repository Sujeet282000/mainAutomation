import type { GraphEdge, GraphNode, WorkflowGraph } from "@algoverge/shared";
import { normalizeWorkflowGraph } from "@algoverge/shared";
import { getApp } from "../catalog";
import { parseAgentOperations, type AgentOperation } from "./operations";

export class AgentOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentOperationError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function node(graph: WorkflowGraph, id: string): GraphNode {
  const found = graph.nodes.find((candidate) => candidate.id === id);
  if (!found) throw new AgentOperationError(`Node not found: ${id}`);
  return found;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordArg(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function assertOperation(appSlug: string, operation: string) {
  const app = getApp(appSlug);
  if (!app) throw new AgentOperationError(`Unknown app: ${appSlug}`);
  const op = app.operations.find((candidate) => candidate.key === operation);
  if (!op) throw new AgentOperationError(`Unknown operation: ${appSlug}.${operation}`);
  return op;
}

function validateShape(graph: WorkflowGraph): void {
  const ids = new Set<string>();
  let triggers = 0;
  for (const n of graph.nodes) {
    if (!n.id || ids.has(n.id)) throw new AgentOperationError(`Duplicate or empty node id: ${n.id}`);
    ids.add(n.id);
    if (n.type === "trigger") triggers += 1;
  }
  if (triggers > 1) throw new AgentOperationError("A workflow can contain only one trigger node.");
  for (const e of graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) throw new AgentOperationError(`Edge references a missing node: ${e.source} → ${e.target}`);
    if (e.source === e.target) throw new AgentOperationError(`Self-loop is not allowed: ${e.source}`);
  }
}

function addNode(graph: WorkflowGraph, args: Record<string, unknown>): void {
  const appSlug = stringArg(args, "appSlug");
  const operation = stringArg(args, "operation");
  if (!appSlug || !operation) throw new AgentOperationError("add_node requires appSlug and operation");
  const op = assertOperation(appSlug, operation);
  const type = op.type === "trigger" ? "trigger" : "action";
  const id = stringArg(args, "nodeId") ?? stringArg(args, "id");
  if (!id) throw new AgentOperationError("add_node requires nodeId");
  if (graph.nodes.some((n) => n.id === id)) throw new AgentOperationError(`Node already exists: ${id}`);
  if (type === "trigger" && graph.nodes.some((n) => n.type === "trigger")) throw new AgentOperationError("Cannot add a second trigger node.");
  const created: GraphNode = {
    id,
    type,
    appSlug,
    operation,
    label: stringArg(args, "label") ?? op.name,
    position: { x: typeof args.x === "number" ? args.x : 420, y: typeof args.y === "number" ? args.y : 180 + graph.nodes.length * 140 },
    config: recordArg(args, "config"),
    connectionId: stringArg(args, "connectionId") ?? null,
  };
  graph.nodes.push(created);
}

function updateNode(graph: WorkflowGraph, args: Record<string, unknown>): void {
  const id = stringArg(args, "nodeId");
  if (!id) throw new AgentOperationError("update_node requires nodeId");
  const current = node(graph, id);
  const appSlug = stringArg(args, "appSlug") ?? current.appSlug;
  const operation = stringArg(args, "operation") ?? current.operation;
  const op = assertOperation(appSlug, operation);
  if (op.type === "trigger" && current.type !== "trigger" && graph.nodes.some((n) => n.id !== id && n.type === "trigger")) throw new AgentOperationError("Cannot create a second trigger node.");
  if (stringArg(args, "appSlug") || stringArg(args, "operation")) {
    current.appSlug = appSlug;
    current.operation = operation;
    current.type = op.type === "trigger" ? "trigger" : "action";
    current.label = stringArg(args, "label") ?? op.name;
  } else if (stringArg(args, "label")) current.label = stringArg(args, "label")!;
  if (args.connectionId !== undefined) current.connectionId = args.connectionId === null ? null : stringArg(args, "connectionId");
  if (args.config && typeof args.config === "object") current.config = { ...current.config, ...recordArg(args, "config") };
  if (typeof args.x === "number" || typeof args.y === "number") current.position = { x: typeof args.x === "number" ? args.x : current.position.x, y: typeof args.y === "number" ? args.y : current.position.y };
}

function connect(graph: WorkflowGraph, args: Record<string, unknown>): void {
  const source = stringArg(args, "source") ?? stringArg(args, "sourceNodeId");
  const target = stringArg(args, "target") ?? stringArg(args, "targetNodeId");
  if (!source || !target) throw new AgentOperationError("connect_nodes requires source and target");
  node(graph, source); node(graph, target);
  if (source === target) throw new AgentOperationError("Cannot connect a node to itself.");
  if (graph.edges.some((e) => e.source === source && e.target === target && e.sourceHandle === (stringArg(args, "sourceHandle") ?? null))) return;
  const edge: GraphEdge = { id: stringArg(args, "edgeId") ?? `e-${source}-${target}`, source, target, sourceHandle: stringArg(args, "sourceHandle") ?? null, condition: args.condition && typeof args.condition === "object" ? recordArg(args, "condition") : null };
  graph.edges.push(edge);
}

export function applyAgentOperations(rawGraph: unknown, rawOperations: unknown[]): WorkflowGraph {
  const graph = clone(normalizeWorkflowGraph(rawGraph));
  let operations: AgentOperation[];
  try { operations = parseAgentOperations(rawOperations); } catch (error) { throw new AgentOperationError(error instanceof Error ? error.message : "Invalid agent operations"); }

  for (const operation of operations) {
    switch (operation.kind) {
      case "add_node": addNode(graph, operation.arguments); break;
      case "remove_node": {
        const id = stringArg(operation.arguments, "nodeId"); if (!id) throw new AgentOperationError("remove_node requires nodeId");
        node(graph, id); graph.nodes = graph.nodes.filter((n) => n.id !== id); graph.edges = graph.edges.filter((e) => e.source !== id && e.target !== id); break;
      }
      case "update_node":
      case "configure_node": updateNode(graph, operation.arguments); break;
      case "connect_nodes": connect(graph, operation.arguments); break;
      case "disconnect_nodes": {
        const source = stringArg(operation.arguments, "source"); const target = stringArg(operation.arguments, "target");
        if (!source || !target) throw new AgentOperationError("disconnect_nodes requires source and target");
        graph.edges = graph.edges.filter((e) => !(e.source === source && e.target === target)); break;
      }
      case "map_field": {
        const id = stringArg(operation.arguments, "nodeId"); const field = stringArg(operation.arguments, "field");
        if (!id || !field) throw new AgentOperationError("map_field requires nodeId and field");
        const n = node(graph, id); n.config = { ...n.config, [field]: operation.arguments.value }; break;
      }
      case "validate_workflow":
      case "test_action":
      case "explain_run":
        // Control-plane operations are handled by their owning API services.
        break;
    }
  }
  validateShape(graph);
  return graph;
}
