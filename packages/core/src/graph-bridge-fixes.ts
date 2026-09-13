import { graphToFlowDefinition as compileGraph } from "./graph-bridge";
import { normalizeWorkflowGraph } from "@algoverge/shared";
import type { TFlowDefinition, Step } from "./flow-schema";
import { expandConfiguredRouters } from "./router-compiler";

/**
 * The React Flow graph is a UI representation; the engine consumes the
 * canonical FlowDefinition. Keep compatibility aliases out of the canonical
 * schema and fail fast on unsupported graph cycles/implicit joins instead of
 * compiling a graph whose runtime semantics differ from the builder.
 */
function assertAcyclicAndUnambiguousGraph(raw: unknown): unknown {
  const normalized = normalizeWorkflowGraph(raw);
  if (!normalized || typeof normalized !== "object") return normalized;
  const graph = normalized as { nodes?: Array<{ id?: string; appSlug?: string }>; edges?: Array<{ source?: string; target?: string }> };
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  const nodeById = new Map<string, { appSlug?: string }>();
  for (const node of nodes) {
    if (typeof node.id === "string") {
      outgoing.set(node.id, []);
      incoming.set(node.id, 0);
      nodeById.set(node.id, node);
    }
  }
  for (const edge of edges) {
    if (typeof edge.source === "string" && typeof edge.target === "string") {
      outgoing.get(edge.source)?.push(edge.target);
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    }
  }
  for (const [id, count] of incoming) {
    if (count > 1 && nodeById.get(id)?.appSlug !== "aggregator") {
      throw new Error(`WORKFLOW_GRAPH_JOIN_REQUIRES_AGGREGATOR:${id}`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`WORKFLOW_GRAPH_CYCLE:${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of outgoing.get(id) ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of outgoing.keys()) visit(id);
  return normalized;
}

function normalizeStep(step: Step): Step {
  const value = step as any;
  if (value.type === "table_op") value.type = "data_table";
  if (value.type === "subflow") value.type = "sub_flow";
  if (value.type === "branch") {
    value.onTrue = (value.onTrue ?? []).map(normalizeStep);
    value.onFalse = (value.onFalse ?? []).map(normalizeStep);
  } else if (value.type === "router") {
    value.branches = (value.branches ?? []).map((branch: any) => ({ ...branch, steps: (branch.steps ?? []).map(normalizeStep) }));
  } else if (value.type === "loop") {
    value.steps = (value.steps ?? []).map(normalizeStep);
  }
  return value as Step;
}

export function graphToFlowDefinition(raw: unknown): TFlowDefinition {
  const normalized = assertAcyclicAndUnambiguousGraph(raw);
  const compiled = compileGraph(normalized) as TFlowDefinition;
  return expandConfiguredRouters({ ...compiled, steps: compiled.steps.map(normalizeStep) }, normalized);
}
