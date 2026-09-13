import { graphToFlowDefinition as compileGraph } from "./graph-bridge";
import type { TFlowDefinition, Step } from "./flow-schema";

/**
 * The React Flow graph is a UI representation; the engine consumes the
 * canonical FlowDefinition. Keep compatibility aliases out of the canonical
 * schema and fail fast on unsupported graph cycles instead of compiling a
 * cycle into a fake successful filter.
 */
function assertAcyclicGraph(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const graph = raw as { nodes?: Array<{ id?: string; type?: string }>; edges?: Array<{ source?: string; target?: string }> };
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) if (typeof node.id === "string") outgoing.set(node.id, []);
  for (const edge of edges) {
    if (typeof edge.source === "string" && typeof edge.target === "string") {
      outgoing.get(edge.source)?.push(edge.target);
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
}

function normalizeStep(step: Step): Step {
  const value = step as any;
  if (value.type === "table_op") value.type = "data_table";
  if (value.type === "subflow") value.type = "sub_flow";

  if (value.type === "branch") {
    value.onTrue = (value.onTrue ?? []).map(normalizeStep);
    value.onFalse = (value.onFalse ?? []).map(normalizeStep);
  } else if (value.type === "router") {
    value.branches = (value.branches ?? []).map((branch: any) => ({
      ...branch,
      steps: (branch.steps ?? []).map(normalizeStep),
    }));
  } else if (value.type === "loop") {
    value.steps = (value.steps ?? []).map(normalizeStep);
  }
  return value as Step;
}

export function graphToFlowDefinition(raw: unknown): TFlowDefinition {
  assertAcyclicGraph(raw);
  const compiled = compileGraph(raw) as TFlowDefinition;
  return {
    ...compiled,
    steps: compiled.steps.map(normalizeStep),
  };
}
