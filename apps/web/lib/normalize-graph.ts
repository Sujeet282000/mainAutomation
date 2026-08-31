export type ApiNode = {
  id: string;
  type: "trigger" | "action" | "logic";
  appSlug: string;
  operation: string;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  connectionId?: string | null;
};

export type ApiGraph = { nodes: ApiNode[]; edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null }> };

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, fallback = "") {
  return v === null || v === undefined ? fallback : String(v);
}

export function emptyAction(id = "action"): ApiNode {
  return {
    id,
    type: "action",
    appSlug: "",
    operation: "",
    label: "Action",
    position: { x: 280, y: 220 },
    config: {},
    connectionId: null
  };
}

export function defaultGraph(): ApiGraph {
  return {
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        appSlug: "",
        operation: "",
        label: "Trigger",
        position: { x: 280, y: 40 },
        config: {},
        connectionId: null
      },
      emptyAction()
    ],
    edges: [{ id: "e-trigger-action", source: "trigger", target: "action" }]
  };
}

export function normalizeGraph(raw: unknown): ApiGraph {
  let parsed: unknown = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }
  const root = rec(parsed);
  const inner = root.graph && typeof root.graph === "object" ? rec(root.graph) : root;

  // Detect Activepieces-style draft_definition: { trigger: {...}, steps: [...] }
  const hasApTrigger = inner.trigger && typeof inner.trigger === "object" && !Array.isArray(inner.trigger);
  const hasApSteps = Array.isArray(inner.steps);
  const hasLegacyNodes = Array.isArray(inner.nodes);

  let nodes: ApiNode[] = [];
  let edges: ApiGraph["edges"] = [];

  if (hasApTrigger || (hasApSteps && !hasLegacyNodes)) {
    // Activepieces format: convert trigger + steps to nodes + edges
    const trig = rec(inner.trigger);
    const trigType = str(trig.type, "manual");
    nodes.push({
      id: str(trig.id, "trigger"),
      type: "trigger",
      appSlug: str(rec(trig.piece).name ?? trig.pieceName ?? trig.appSlug ?? trig.app_slug ?? "", ""),
      operation: str(trig.operation ?? trig.key ?? trig.event, trigType === "manual" ? "button" : ""),
      label: str(trig.name ?? trig.label, "Trigger"),
      position: { x: 280, y: 40 },
      config: rec(trig.props ?? trig.config ?? trig.input),
      connectionId: (trig.connectionId ?? trig.connection_id ?? null) as string | null
    });

    const steps = Array.isArray(inner.steps) ? inner.steps : [];
    steps.forEach((item: unknown, i: number) => {
      const s = rec(item);
      const data = rec(s.data);
      const m = { ...s, ...data };
      const typeRaw = str(m.type ?? m.kind, "action").toLowerCase();
      const type: ApiNode["type"] =
        typeRaw === "logic" || typeRaw === "filter" || typeRaw === "path" || typeRaw === "paths"
          ? "logic"
          : "action";
      nodes.push({
        id: str(m.id, `step-${i}`),
        type,
        appSlug: str(m.appSlug ?? m.app_slug ?? rec(m.piece).name ?? m.pieceName ?? m.app ?? m.slug, ""),
        operation: str(m.operation ?? m.event ?? m.key ?? m.op, ""),
        label: str(m.label ?? m.name, type === "logic" ? "Logic" : "Action"),
        position: { x: 280, y: 40 + (i + 1) * 180 },
        config: rec(m.config ?? m.input),
        connectionId: (m.connectionId ?? m.connection_id ?? null) as string | null
      });
    });

    // Build sequential edges between nodes
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({
        id: `e-${nodes[i].id}-${nodes[i + 1].id}`,
        source: nodes[i].id,
        target: nodes[i + 1].id,
        sourceHandle: null
      });
    }
  } else {
    // Legacy graph format: { nodes: [...], edges: [...] }
    const list = Array.isArray(inner.nodes) ? inner.nodes : [];

    nodes = list.map((item: unknown, i: number) => {
      const n = rec(item);
      const data = rec(n.data);
      const m = { ...n, ...data };
      const typeRaw = str(m.type ?? m.kind, "action").toLowerCase();
      const resolved =
        typeRaw === "step" || typeRaw === "default"
          ? str(m.kind ?? m.nodeKind, "action").toLowerCase()
          : typeRaw;
      const type: ApiNode["type"] =
        resolved === "trigger"
          ? "trigger"
          : resolved === "logic" || resolved === "filter" || resolved === "path" || resolved === "paths"
            ? "logic"
            : "action";
      return {
        id: str(m.id, `n${i}`),
        type,
        appSlug: str(m.appSlug ?? m.app_slug ?? m.app ?? m.slug, ""),
        operation: str(m.operation ?? m.event ?? m.key ?? m.op, ""),
        label: str(m.label ?? m.name, type === "trigger" ? "Trigger" : "Action"),
        position: {
          x: Number(rec(m.position).x ?? m.x ?? 280) || 280,
          y: Number(rec(m.position).y ?? m.y ?? 48 + i * 160) || 48 + i * 160
        },
        config: rec(m.config ?? m.input),
        connectionId: (m.connectionId ?? m.connection_id ?? m.connectionId ?? null) as string | null
      };
    });

    edges = (Array.isArray(inner.edges) ? inner.edges : [])
      .map((item: unknown, i: number) => {
        const e = rec(item);
        return {
          id: str(e.id, `e${i}`),
          source: str(e.source ?? e.from),
          target: str(e.target ?? e.to),
          sourceHandle: (e.sourceHandle ?? e.source_handle ?? null) as string | null
        };
      })
      .filter((e) => e.source && e.target);
  }

  if (!nodes.some((n) => n.type === "trigger")) {
    nodes.unshift({
      id: "trigger",
      type: "trigger",
      appSlug: "manual",
      operation: "button",
      label: "Trigger",
      position: { x: 280, y: 40 },
      config: {},
      connectionId: null
    });
  }
  if (!nodes.some((n) => n.type !== "trigger")) {
    const trigger = nodes.find((n) => n.type === "trigger")!;
    const action = emptyAction();
    action.position = { x: trigger.position.x, y: trigger.position.y + 180 };
    nodes.push(action);
    edges.push({ id: `e-${trigger.id}-action`, source: trigger.id, target: action.id, sourceHandle: null });
  }

  // Never render edges whose endpoints are absent. Stale/dangling edges can
  // otherwise produce detached PlusEdge labels/buttons far away from the graph.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const seenEdges = new Set<string>();
  edges = edges.filter((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false;
    if (edge.source === edge.target) return false;
    const key = `${edge.source}|${edge.target}|${edge.sourceHandle ?? ""}`;
    if (seenEdges.has(key)) return false;
    seenEdges.add(key);
    return true;
  });

  return { nodes, edges };
}