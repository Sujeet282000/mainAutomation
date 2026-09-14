import type { Edge, Node } from "reactflow";
import type { StepData } from "./store";

const COL = 320;
const ROW = 168;

export function layoutFlow(nodes: Node<StepData>[], edges: Edge[]): Node<StepData>[] {
  const trigger = nodes.find((n) => n.data.kind === "trigger") ?? nodes[0];
  if (!trigger) return nodes;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const kids = new Map<string, string[]>();
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target) || e.source === e.target) continue;
    const arr = kids.get(e.source) ?? [];
    if (!arr.includes(e.target)) arr.push(e.target);
    kids.set(e.source, arr);
  }

  // Layout is a best-effort visual operation. Validation owns graph errors,
  // so a malformed draft must never make the renderer recurse forever.
  const widthMemo = new Map<string, number>();
  const widthOf = (id: string, visiting = new Set<string>()): number => {
    if (widthMemo.has(id)) return widthMemo.get(id)!;
    if (visiting.has(id)) return COL;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(id);
    const c = (kids.get(id) ?? []).filter((child) => child !== id);
    if (!c.length) {
      widthMemo.set(id, COL);
      return COL;
    }
    const width = Math.max(COL, c.reduce((sum, child) => sum + widthOf(child, nextVisiting), 0));
    widthMemo.set(id, width);
    return width;
  };

  const pos = new Map<string, { x: number; y: number }>();
  const place = (id: string, cx: number, y: number, visiting = new Set<string>()) => {
    if (pos.has(id)) return;
    pos.set(id, { x: cx - 140, y });
    const nextVisiting = new Set(visiting);
    nextVisiting.add(id);
    const c = (kids.get(id) ?? []).filter((child) => !nextVisiting.has(child));
    if (!c.length) return;
    const widths = c.map((child) => widthOf(child));
    const total = widths.reduce((a, b) => a + b, 0);
    let x = cx - total / 2;
    c.forEach((child, i) => {
      place(child, x + widths[i] / 2, y + ROW, nextVisiting);
      x += widths[i];
    });
  };

  place(trigger.id, 480, 48);

  let orphanY = 48;
  return nodes.map((n) => {
    const p = pos.get(n.id);
    if (p) return { ...n, position: p };
    orphanY += ROW;
    return { ...n, position: { x: 40, y: orphanY } };
  });
}
