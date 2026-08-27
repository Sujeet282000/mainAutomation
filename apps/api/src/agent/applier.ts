import type { WorkflowGraph, GraphNode, GraphEdge } from "@algoverge/shared";
import { AgentOperation } from "./operations";

export class AgentOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentOperationError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertNode(graph: WorkflowGraph, nodeId: string): GraphNode {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new AgentOperationError(`Node not found: ${nodeId}`);
  return node;
}

function validateGraphShape(graph: WorkflowGraph) {
  const ids = new Set<string>();
  let triggers = 0;
  for (const node of graph.nodes) {
    if (!node.id || ids.has(node.id)) throw new AgentOperationError(`Duplicate or empty node id: ${node.id}`);
    ids.add(node.id);
    if (node.type === "trigger") triggers += 1;
  }
  if (triggers > 1) throw new AgentOperationError("A workflow can contain only one trigger node.");
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      throw new AgentOperationError(`Edge references a missing node: ${edge.source} → ${edge.target}`);
    }
    if (edge.source === edge.target) throw new AgentOperationError(`Self-loop is not allowed: ${edge.source}`);
  }
}

/**
 * Deterministic graph mutation boundary. No LLM calls, credentials, external
 * requests, or persistence belong here. This function only applies the
 * already-structured operation vocabulary to a canonical WorkflowGraph.
 */
export function applyAgentOperations(graph: WorkflowGraph, rawOperations: unknown[]): WorkflowGraph {
  const operations = rawOperations.map((operation, index) => {
    const parsed = AgentOperation.safeParse(operation);
    if (!parsed.success) {
      throw new AgentOperationError(`Invalid AgentOperation at index ${index}: ${parsed.error.message}`);
    }
    return parsed.data;
  });

  const next = clone(graph);

  for (const operation of operations) {
    switch (operation.type) {
      case "ADD_NODE": {
        if (next.nodes.some((node) => node.id === operation.node.id)) {
          throw new AgentOperationError(`Node already exists: ${operation.node.id}`);
        }
        if (operation.node.type === "trigger" && next.nodes.some((node) => node.type === "trigger")) {
          throw new AgentOperationError("Cannot add a second trigger node.");
        }
        next.nodes.push(operation.node);
        break;
      }
      case "REMOVE_NODE": {
        assertNode(next, operation.nodeId);
        next.nodes = next.nodes.filter((node) => node.id !== operation.nodeId);
        next.edges = next.edges.filter((edge) => edge.source !== operation.nodeId && edge.target !== operation.nodeId);
        break;
      }
      case "UPDATE_NODE": {
        const node = assertNode(next, operation.nodeId);
        const patch = operation.patch;
        if (patch.type === "trigger" && node.type !== "trigger" && next.nodes.some((candidate) => candidate.id !== node.id && candidate.type === "trigger")) {
          throw new AgentOperationError("Cannot convert a node into a second trigger.");
        }
        Object.assign(node, patch);
        break;
      }
      case "CONNECT_NODES": {
        assertNode(next, operation.source);
        assertNode(next, operation.target);
        if (operation.source === operation.target) throw new AgentOperationError("Cannot connect a node to itself.");
        const duplicate = next.edges.some((edge) => edge.source === operation.source && edge.target === operation.target && edge.sourceHandle === operation.sourceHandle);
        if (!duplicate) {
          const id = `e-${operation.source}-${operation.target}${operation.sourceHandle ? `-${operation.sourceHandle}` : ""}`;
          next.edges.push({ id, source: operation.source, target: operation.target, sourceHandle: operation.sourceHandle ?? null, condition: operation.condition ?? null });
        }
        break;
      }
      case "DISCONNECT_NODES":
        next.edges = next.edges.filter((edge) => !(edge.source === operation.source && edge.target === operation.target));
        break;
      case "MAP_FIELD": {
        const node = assertNode(next, operation.nodeId);
        node.config = { ...node.config, [operation.field]: operation.value };
        break;
      }
      case "CONFIGURE_NODE": {
        const node = assertNode(next, operation.nodeId);
        node.config = { ...node.config, ...operation.config };
        break;
      }
      case "VALIDATE_WORKFLOW":
      case "TEST_WORKFLOW":
      case "EXPLAIN_WORKFLOW":
        // Control operations are intentionally handled by their respective
        // API services. They never mutate the graph here.
        break;
    }
  }

  validateGraphShape(next);
  return next;
}
