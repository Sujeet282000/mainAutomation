import { create } from "zustand";
import type { Edge, Node } from "reactflow";

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

export const useBuilderStore = create<BuilderState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedId: null,
  dirty: false,
  past: [],
  future: [],
  hydrate: (nodes, edges) => set({ nodes, edges, dirty: false, past: [], future: [], selectedId: nodes[0]?.id ?? null }),
  setSelected: (selectedId) => set({ selectedId }),
  setGraph: (nodes, edges, pushHistory = true) => {
    const cur = { nodes: get().nodes, edges: get().edges };
    set({
      nodes,
      edges,
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
    const nodes = cur.nodes.filter((n) => n.id !== id);
    const incoming = cur.edges.filter((e) => e.target === id);
    const outgoing = cur.edges.filter((e) => e.source === id);
    let edges = cur.edges.filter((e) => e.source !== id && e.target !== id);
    for (const inn of incoming) {
      for (const out of outgoing) {
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
    set({
      past: past.slice(0, -1),
      future: [{ nodes: get().nodes, edges: get().edges }, ...get().future],
      nodes: prev.nodes,
      edges: prev.edges,
      dirty: true
    });
  },
  redo: () => {
    const future = get().future;
    if (!future.length) return;
    const next = future[0];
    set({
      future: future.slice(1),
      past: [...get().past, { nodes: get().nodes, edges: get().edges }],
      nodes: next.nodes,
      edges: next.edges,
      dirty: true
    });
  },
  markSaved: () => set({ dirty: false })
}));

export { empty };
