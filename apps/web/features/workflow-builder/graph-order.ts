import type { Edge, Node } from "reactflow";
import type { StepData } from "./store";

/**
 * Canonical display/execution ordering for the builder.
 *
 * React Flow's `nodes` array is a storage/rendering collection, not the
 * workflow's semantic order. Edges are the source of truth. For linear flows
 * this follows the trigger through each outgoing edge; for branches it keeps
 * edge declaration order and then appends any disconnected/cyclic nodes in a
 * stable order instead of inventing a new relationship.
 */
export function executionOrderIds(nodes: Node<StepData>[], edges: Edge[]): string[] {
  if (!nodes.length) return [];

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();

  for (const node of nodes) incoming.set(node.id, 0);
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target) || edge.source === edge.target) continue;
    const list = outgoing.get(edge.source) ?? [];
    if (!list.includes(edge.target)) {
      list.push(edge.target);
      outgoing.set(edge.source, list);
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    }
  }

  const result: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    result.push(id);
    for (const child of outgoing.get(id) ?? []) visit(child);
  };

  const triggers = nodes.filter((node) => node.data.kind === "trigger");
  for (const trigger of triggers) visit(trigger.id);

  // A valid multi-root graph may have non-trigger roots (for example while a
  // draft is being assembled). Keep them deterministic and reachable.
  for (const node of nodes) {
    if ((incoming.get(node.id) ?? 0) === 0) visit(node.id);
  }

  // Invalid/cyclic drafts must still render safely. Do not hang or drop nodes;
  // validation will report the graph problem separately.
  for (const node of nodes) visit(node.id);

  return result;
}

export function orderNodesByGraph(nodes: Node<StepData>[], edges: Edge[]): Node<StepData>[] {
  const ids = executionOrderIds(nodes, edges);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}
