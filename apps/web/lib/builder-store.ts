import { create } from "zustand";
import type { Edge, Node } from "reactflow";

type BuilderState = {
  nodes: Node[];
  edges: Edge[];
  selectedId: string | null;
  setGraph: (nodes: Node[], edges: Edge[]) => void;
  setSelected: (id: string | null) => void;
  updateNodeData: (id: string, data: Record<string, unknown>) => void;
};

export const useBuilderStore = create<BuilderState>((set) => ({
  nodes: [],
  edges: [],
  selectedId: null,
  setGraph: (nodes, edges) => set({ nodes, edges }),
  setSelected: (selectedId) => set({ selectedId }),
  updateNodeData: (id, data) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n))
    }))
}));
