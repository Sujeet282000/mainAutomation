import { create } from "zustand";
import type { Edge, Node } from "reactflow";
import { orderNodesByGraph } from "./graph-order";
import { wouldCreateCycle } from "./graph-validation";

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
  insertNodeAfterNode: (afterNodeId: string, data: StepData) => string | null;
  connectNodes: (source: string, target: string, sourceHandle?: string | null) => boolean;
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
  insertNodeAfterNode: (afterNodeId, data) => {
    const cur = get();
    const after = cur.nodes.find((n) => n.id === afterNodeId);
    if (!after) return null;

    const id = `${data.appSlug || "step"}-${Date.now()}`;
    const node: Node<StepData> = { id, type: "step", position: { x: 0, y: 0 }, data };
    const outgoing = cur.edges.filter((e) => e.source === afterNodeId);

    let nextEdges: Edge[];
    if (outgoing.length) {
      // A → B becomes A → NEW → B for the first successor; multi-branch nodes
      // keep their other handles untouched (each handle splices its own edge).
      const first = outgoing[0];
      nextEdges = cur.edges
        .filter((e) => e.id !== first.id)
        .concat([
          { id: `e-${afterNodeId}-${id}`, source: afterNodeId, target: id, sourceHandle: first.sourceHandle, type: "plus" },
          { id: `e-${id}-${first.target}`, source: id, target: first.target, type: "plus" }
        ]);
    } else {
      // Terminal node: just append A → NEW.
      nextEdges = [...cur.edges, { id: `e-${afterNodeId}-${id}`, source: afterNodeId, target: id, type: "plus" }];
    }

    cur.setGraph([...cur.nodes, node], nextEdges);
    return id;
  },
  connectNodes: (source, target, sourceHandle) => {
    const cur = get();
    if (source === target) return false;
    if (!cur.nodes.some((n) => n.id === source) || !cur.nodes.some((n) => n.id === target)) return false;
    const edge: Edge = {
      id: `e-${source}-${target}${sourceHandle ? `-${sourceHandle}` : ""}`,
      source,
      target,
      ...(sourceHandle ? { sourceHandle } : {}),
      type: "plus"
    };
    const key = `${edge.source}->${edge.target}:${edge.sourceHandle ?? ""}`;
    if (cur.edges.some((e) => `${e.source}->${e.target}:${e.sourceHandle ?? ""}` === key)) return false;
    // Structural edits must never build a cyclic graph: the compiler rejects
    // cycles at save time, so reject them here where the user is still looking.
    if (wouldCreateCycle(cur.edges, source, target)) return false;
    cur.setGraph(cur.nodes, [...cur.edges, edge]);
    return true;
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
