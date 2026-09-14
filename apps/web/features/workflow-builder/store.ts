import { create } from "zustand";
import type { Edge, Node } from "reactflow";
import { orderNodesByGraph } from "./graph-order";

export type StepData = {
  label: string;
  kind: "trigger" | "action" | "logic";
  appSlug: string;
  operation: string;
  config: Record<string, unknown>;
  connectionId?: string | null;
};

type Snap = { nodes: Node<StepData>[]; edges: Edge[] };

type BuilderState = {
  nodes: Node<StepData>[];
  edges: Edge[];
  selectedId: string | null;
  dirty: boolean;
  past: Snap[];
  future: Snap[];
  hydrate: (nodes: Node<StepData>[], edges: Edge[]) => void;
  setSelected: (id: string | null) => void;
  setGraph: (nodes: Node<StepData>[], edges: Edge[], pushHistory?: boolean) => void;
  updateNode: (id: string, patch: Partial<StepData>) => void;
  removeNode: (id: string) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
};

const empty: Snap = { nodes: [], edges: [] };

function normalizeBuilderGraph(nodes: Node<StepData>[], edges: Edge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  const validEdges = edges.filter((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false;
    if (edge.source === edge.target) return false;
    const key = `${edge.source}->${edge.target}:${edge.sourceHandle ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { nodes: orderNodesByGraph(nodes, validEdges), edges: validEdges };
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedId: null,
  dirty: false,
  past: [],
  future: [],
  hydrate: (nodes, edges) => {
    const graph = normalizeBuilderGraph(nodes, edges);
    set({ ...graph, dirty: false, past: [], future: [], selectedId: nodes[0]?.id ?? null });
  },
  setSelected: (selectedId) => set({ selectedId }),
  setGraph: (nodes, edges, pushHistory = true) => {
    const cur = { nodes: get().nodes, edges: get().edges };
    const graph = normalizeBuilderGraph(nodes, edges);
    set({
      ...graph,
      dirty: true,
      past: pushHistory ? [...get().past.slice(-40), cur] : get().past,
      future: pushHistory ? [] : get().future
    });
  },
  updateNode: (id, patch) => {
    const nodes = get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
    get().setGraph(nodes, get().edges);
  },
  removeNode: (id) => {
    const cur = get();
    const node = cur.nodes.find((n) => n.id === id);
    if (!node || node.data.kind === "trigger") return;

    const nodes = cur.nodes.filter((n) => n.id !== id);
    const incoming = cur.edges.filter((e) => e.target === id);
    const outgoing = cur.edges.filter((e) => e.source === id);
    let edges = cur.edges.filter((e) => e.source !== id && e.target !== id);

    // For a normal linear step, reconnect each incoming predecessor to each
    // outgoing successor. For branches this preserves the existing source
    // handles rather than inventing a new branch relationship.
    for (const inn of incoming) {
      for (const out of outgoing) {
        const idempotency = `${inn.source}->${out.target}:${inn.sourceHandle ?? ""}`;
        if (edges.some((edge) => `${edge.source}->${edge.target}:${edge.sourceHandle ?? ""}` === idempotency)) continue;
        edges.push({
          id: `e-${inn.source}-${out.target}-${inn.sourceHandle ?? ""}`,
          source: inn.source,
          target: out.target,
          sourceHandle: inn.sourceHandle,
          type: "plus"
        });
      }
    }

    cur.setGraph(nodes, edges);
    if (cur.selectedId === id) get().setSelected(nodes[0]?.id ?? null);
  },
  undo: () => {
    const past = get().past;
    if (!past.length) return;
    const prev = past[past.length - 1];
    const graph = normalizeBuilderGraph(prev.nodes, prev.edges);
    set({
      past: past.slice(0, -1),
      future: [{ nodes: get().nodes, edges: get().edges }, ...get().future],
      ...graph,
      dirty: true
    });
  },
  redo: () => {
    const future = get().future;
    if (!future.length) return;
    const next = future[0];
    const graph = normalizeBuilderGraph(next.nodes, next.edges);
    set({
      future: future.slice(1),
      past: [...get().past, { nodes: get().nodes, edges: get().edges }],
      ...graph,
      dirty: true
    });
  },
  markSaved: () => set({ dirty: false })
}));

export { empty };
