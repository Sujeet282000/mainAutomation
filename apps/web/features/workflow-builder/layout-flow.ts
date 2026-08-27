import type { Edge, Node } from "reactflow";
import type { StepData } from "./store";

const COL = 320;
const ROW = 168;

export function layoutFlow(nodes: Node<StepData>[], edges: Edge[]): Node<StepData>[] {
  const trigger = nodes.find((n) => n.data.kind === "trigger") ?? nodes[0];
  if (!trigger) return nodes;
  const kids = new Map<string, string[]>();
  for (const e of edges) {
    const arr = kids.get(e.source) ?? [];
    if (!arr.includes(e.target)) arr.push(e.target);
    kids.set(e.source, arr);
  }
  const widthOf = (id: string): number => {
    const c = kids.get(id) ?? [];
    if (!c.length) return COL;
    return Math.max(COL, c.reduce((s, k) => s + widthOf(k), 0));
  };
  const pos = new Map<string, { x: number; y: number }>();
  const place = (id: string, cx: number, y: number) => {
    pos.set(id, { x: cx - 140, y });
    const c = kids.get(id) ?? [];
    if (!c.length) return;
    const widths = c.map(widthOf);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = cx - total / 2;
    c.forEach((child, i) => {
      place(child, x + widths[i] / 2, y + ROW);
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
