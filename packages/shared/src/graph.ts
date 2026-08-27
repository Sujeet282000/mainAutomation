import type { GraphEdge, GraphNode, GraphNodeType, WorkflowGraph } from "./index";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function positionOf(n: Record<string, unknown>, index: number) {
  const p = asRecord(n.position);
  const x = Number(p.x ?? n.x ?? 280);
  const y = Number(p.y ?? n.y ?? 48 + index * 160);
  return { x: Number.isFinite(x) ? x : 280, y: Number.isFinite(y) ? y : 48 + index * 160 };
}

function nodeType(n: Record<string, unknown>, opType: string): GraphNodeType {
  const raw = str(n.type ?? n.kind ?? opType, "action").toLowerCase();
  // React Flow uses `type` for renderers (`step` / `default`). Graph kind lives on `kind`.
  const t =
    raw === "step" || raw === "default" || raw === "input" || raw === "output"
      ? str(n.kind ?? n.nodeKind ?? opType, "action").toLowerCase()
      : raw;
  if (t === "trigger") return "trigger";
  if (t === "logic" || t === "filter" || t === "path" || t === "paths" || t === "loop" || t === "delay" || t === "formatter") {
    return "logic";
  }
  if (opType === "trigger") return "trigger";
  return "action";
}

export function emptyActionNode(id = "action"): GraphNode {
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

export function defaultWorkflowGraph(): WorkflowGraph {
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
      emptyActionNode(),
    ],
    edges: [{ id: "e-trigger-action", source: "trigger", target: "action" }]
  };
}

/** Accepts stored graphs, React Flow docs, Zapier-like `steps`, snake_case, and JSON strings. */
export function normalizeWorkflowGraph(raw: unknown): WorkflowGraph {
  let parsed: unknown = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }
  const root = asRecord(parsed);
  const inner = root.graph && typeof root.graph === "object" ? asRecord(root.graph) : root;
  const list = Array.isArray(inner.nodes)
    ? inner.nodes
    : Array.isArray(inner.steps)
      ? inner.steps
      : [];

  const nodes: GraphNode[] = list.map((item, i) => {
    const n = asRecord(item);
    const data = asRecord(n.data);
    const merged = { ...n, ...data };
    const appSlug = str(
      merged.appSlug ?? merged.appSlug ?? merged.app_slug ?? merged.app ?? merged.slug,
      ""
    );
    const operation = str(
      merged.operation ?? merged.operation ?? merged.event ?? merged.key ?? merged.op,
      ""
    );
    const type = nodeType(merged, str(merged.opType ?? merged.operationType, ""));
    return {
      id: str(merged.id, `n${i}`),
      type,
      appSlug,
      operation,
      label: str(merged.label ?? merged.name ?? merged.title, type === "trigger" ? "Trigger" : "Action"),
      position: positionOf(merged, i),
      config: asRecord(merged.config ?? merged.input ?? merged.fields),
      connectionId: (merged.connectionId ?? merged.connection_id ?? merged.connectionId ?? null) as string | null
    };
  });

  const edgeList = Array.isArray(inner.edges) ? inner.edges : [];
  const edges: GraphEdge[] = edgeList.map((item, i) => {
    const e = asRecord(item);
    return {
      id: str(e.id, `e${i}`),
      source: str(e.source ?? e.from),
      target: str(e.target ?? e.to),
      sourceHandle: (e.sourceHandle ?? e.source_handle ?? null) as string | null
    };
  }).filter((e) => e.source && e.target);

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
    const action = emptyActionNode();
    action.position = { x: trigger.position.x, y: trigger.position.y + 180 };
    nodes.push(action);
    if (!edges.some((e) => e.source === trigger.id && e.target === action.id)) {
      edges.push({ id: `e-${trigger.id}-${action.id}`, source: trigger.id, target: action.id });
    }
  }

  return { nodes, edges };
}
