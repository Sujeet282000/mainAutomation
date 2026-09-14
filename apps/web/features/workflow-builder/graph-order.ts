import type { Edge, Node } from "reactflow";
import type { StepData } from "./store";

/**
 * Canonical display/execution ordering for the builder.
 * React Flow's `nodes` array is a storage/rendering collection, not semantic
 * workflow order. Edges are the source of truth. A stable topological sort
 * keeps joins after every predecessor while preserving edge declaration order.
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
    if (list.includes(edge.target)) continue;
    list.push(edge.target);
    outgoing.set(edge.source, list);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const result: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = [];
  const enqueue = (id: string) => {
    if (!seen.has(id) && byId.has(id) && !queue.includes(id)) queue.push(id);
  };

  // Triggers are always the first visible roots.
  for (const node of nodes) if (node.data.kind === "trigger") enqueue(node.id);
  // Drafts can temporarily contain additional roots while they are being built.
  for (const node of nodes) if ((incoming.get(node.id) ?? 0) === 0) enqueue(node.id);

  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    for (const child of outgoing.get(id) ?? []) {
      const nextIncoming = (incoming.get(child) ?? 0) - 1;
      incoming.set(child, nextIncoming);
      if (nextIncoming === 0) enqueue(child);
    }
  }

  // Cyclic/invalid drafts must still render safely. Append unresolved nodes in
  // their stable original order; workflow validation reports the actual error.
  for (const node of nodes) if (!seen.has(node.id)) result.push(node.id);
  return result;
}

export function orderNodesByGraph(nodes: Node<StepData>[], edges: Edge[]): Node<StepData>[] {
  const ids = executionOrderIds(nodes, edges);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}
