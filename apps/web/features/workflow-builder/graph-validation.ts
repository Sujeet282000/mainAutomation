import type { Edge } from "reactflow";

/**
 * Graph-level validation for the builder. The backend compiler refuses
 * cycles/joins/forks with loud errors; the editor must prevent the user from
 * ever building those graphs instead of failing at save/publish time.
 */

/**
 * True when `target` can already reach `source` through the existing edges.
 * Adding `source -> target` then closes a cycle exactly in that case.
 */
export function wouldCreateCycle(edges: Edge[], source: string, target: string): boolean {
  if (!source || !target) return false;
  if (source === target) return true;

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge.source || !edge.target || edge.source === edge.target) continue;
    const list = outgoing.get(edge.source) ?? [];
    if (!list.includes(edge.target)) list.push(edge.target);
    outgoing.set(edge.source, list);
  }

  // BFS from `target`: if we can reach `source`, the new edge closes a loop.
  const queue = [target];
  const seen = new Set<string>([target]);
  while (queue.length) {
    const id = queue.shift()!;
    if (id === source) return true;
    for (const next of outgoing.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/** True when the current edge set already contains a cycle. */
export function hasCycle(edges: Edge[]): boolean {
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const edge of edges) {
    if (!edge.source || !edge.target || edge.source === edge.target) continue;
    const list = outgoing.get(edge.source) ?? [];
    if (!list.includes(edge.target)) list.push(edge.target);
    outgoing.set(edge.source, list);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    if (!indegree.has(edge.source)) indegree.set(edge.source, 0);
  }

  const queue = [...indegree.entries()].filter(([, deg]) => deg === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const next of outgoing.get(id) ?? []) {
      const deg = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  return visited !== indegree.size;
}
