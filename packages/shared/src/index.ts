export type GraphNodeType = "trigger" | "action" | "logic";

export {
  defaultWorkflowGraph,
  emptyActionNode,
  normalizeWorkflowGraph
} from "./graph";

export type GraphNode = {
  id: string;
  type: GraphNodeType;
  appSlug: string;
  operation: string;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  connectionId?: string | null;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  condition?: Record<string, unknown> | null;
};

export type WorkflowGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type FieldDef = {
  key: string;
  label: string;
  type:
    | "string"
    | "text"
    | "number"
    | "boolean"
    | "json"
    | "select"
    | "dynamic"
    | "code"
    | "datetime"
    | "file"
    | "mapping";
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { label: string; value: string }[];
  dependsOn?: string[];
};

export type AppOperation = {
  key: string;
  name: string;
  description?: string;
  type: "trigger" | "action" | "search";
  triggerMode?: "webhook" | "polling" | "schedule" | "manual" | "form" | "table" | "api";
  inputFields?: FieldDef[];
  outputSample?: Record<string, unknown>;
  [extra: string]: unknown;
};

export type AppManifest = {
  slug: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  authType?: string;
  operations: AppOperation[];
  [extra: string]: unknown;
};

export const EXECUTION_STATUSES = [
  "queued",
  "running",
  "waiting",
  "paused",
  "succeeded",
  "failed",
  "partially_succeeded",
  "cancelled",
  "timed_out"
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

const PATH_HEAD_ALIASES: Record<string, string> = {
  Trigger: "trigger",
  trigger: "trigger",
  Steps: "steps",
  steps: "steps",
  Vars: "vars",
  vars: "vars",
  Item: "item",
  item: "item"
};

function walkPath(root: unknown, keys: string[]): unknown {
  return keys.reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    const rec = acc as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(rec, key)) return rec[key];
    const match = Object.keys(rec).find((k) => k.toLowerCase() === key.toLowerCase());
    return match ? rec[match] : undefined;
  }, root);
}

export function interpolate(template: unknown, context: Record<string, unknown>): unknown {
  if (typeof template !== "string") {
    if (Array.isArray(template)) return template.map((v) => interpolate(v, context));
    if (template && typeof template === "object") {
      return Object.fromEntries(
        Object.entries(template as Record<string, unknown>).map(([k, v]) => [k, interpolate(v, context)])
      );
    }
    return template;
  }
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, path: string) => {
    const [head, ...pipes] = String(path).split("|").map((s) => s.trim());
    let value = getPath(context, head);
    for (const p of pipes) {
      const [fn, arg] = p.split(":");
      if (fn === "upper") value = String(value ?? "").toUpperCase();
      else if (fn === "lower") value = String(value ?? "").toLowerCase();
      else if (fn === "trim") value = String(value ?? "").trim();
      else if (fn === "default") value = value === undefined || value === null || value === "" ? arg : value;
    }
    if (value === undefined || value === null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

export function getPath(obj: unknown, path: string): unknown {
  const keys = path.split(".").map((p) => p.trim()).filter(Boolean);
  if (!keys.length) return undefined;
  const alias = PATH_HEAD_ALIASES[keys[0]] ?? PATH_HEAD_ALIASES[keys[0].toLowerCase()];
  if (alias) {
    const aliased = walkPath(obj, [alias, ...keys.slice(1)]);
    if (aliased !== undefined) return aliased;
  }
  const direct = walkPath(obj, keys);
  if (direct !== undefined) return direct;
  if (obj && typeof obj === "object") {
    const ctx = obj as Record<string, unknown>;
    if (ctx.trigger && typeof ctx.trigger === "object" && keys.length === 1) {
      const fromTrigger = walkPath(ctx.trigger, keys);
      if (fromTrigger !== undefined) return fromTrigger;
    }
    if (ctx.steps && typeof ctx.steps === "object") {
      const steps = ctx.steps as Record<string, unknown>;
      const needle = keys[0].replace(/\s+/g, "").toLowerCase();
      const stepKey = Object.keys(steps).find((k) => k.replace(/\s+/g, "").toLowerCase() === needle);
      if (stepKey) return keys.length === 1 ? steps[stepKey] : walkPath(steps[stepKey], keys.slice(1));
    }
  }
  return undefined;
}

export type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "exists"
  | "not_exists"
  | "empty"
  | "not_empty";

export function evaluateCondition(left: unknown, operator: FilterOperator, right: unknown): boolean {
  const l = left === undefined || left === null ? "" : String(left);
  const r = right === undefined || right === null ? "" : String(right);
  switch (operator) {
    case "equals":
      return l === r;
    case "not_equals":
      return l !== r;
    case "contains":
      return l.toLowerCase().includes(r.toLowerCase());
    case "not_contains":
      return !l.toLowerCase().includes(r.toLowerCase());
    case "starts_with":
      return l.toLowerCase().startsWith(r.toLowerCase());
    case "ends_with":
      return l.toLowerCase().endsWith(r.toLowerCase());
    case "gt":
      return Number(left) > Number(right);
    case "lt":
      return Number(left) < Number(right);
    case "gte":
      return Number(left) >= Number(right);
    case "lte":
      return Number(left) <= Number(right);
    case "exists":
      return left !== undefined && left !== null;
    case "not_exists":
      return left === undefined || left === null;
    case "empty":
      return l.length === 0;
    case "not_empty":
      return l.length > 0;
    default:
      return false;
  }
}
