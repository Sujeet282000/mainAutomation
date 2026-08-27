export type FieldDef = {
  key?: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { label: string; value: string }[] | string[];
  dependsOn?: string[];
};

export type CatalogOp = {
  name: string;
  type: "trigger" | "action" | "search";
  description?: string;
  key?: string;
  triggerMode?: string;
  inputFields?: FieldDef[];
  outputSample?: Record<string, unknown>;
};

export type CatalogApp = {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  color?: string;
  authType?: string;
  operations: CatalogOp[];
};

export function opKey(op: CatalogOp) {
  const anyOp = op as CatalogOp & { operation_id?: string; operationId?: string };
  return anyOp.key || anyOp.operation_id || anyOp.operationId || "";
}

export function opFields(op: CatalogOp): FieldDef[] {
  return op.inputFields ?? (op as { inputFields?: FieldDef[] }).inputFields ?? [];
}

export function fieldKey(f: FieldDef) {
  return f.key ?? (f as { key?: string }).key ?? "";
}

export function appAuth(app: CatalogApp) {
  return app.authType ?? (app as { authType?: string }).authType ?? "none";
}

export function opSample(op: CatalogOp) {
  return op.outputSample ?? (op as { outputSample?: Record<string, unknown> }).outputSample ?? {};
}

export function needsConnection(app: CatalogApp) {
  const auth = appAuth(app);
  return Boolean(auth && auth !== "none");
}

export function logicKind(
  slug: string
): "filter" | "path" | "loop" | "delay" | "formatter" | "code" | "webhook" | "http" | "ai" | "approval" | "subflow" | "action" {
  if (slug === "filter") return "filter";
  if (slug === "paths") return "path";
  if (slug === "loop") return "loop";
  if (slug === "delay") return "delay";
  if (slug === "formatter") return "formatter";
  if (slug === "code") return "code";
  if (slug === "webhook") return "webhook";
  if (slug === "http") return "http";
  if (slug === "openai" || slug === "anthropic" || slug === "gemini") return "ai";
  if (slug === "approval") return "approval";
  if (slug === "subflow") return "subflow";
  return "action";
}

export function graphNodeType(op: CatalogOp, slug: string): "trigger" | "action" | "logic" {
  if (op.type === "trigger") return "trigger";
  const k = logicKind(slug);
  if (k === "filter" || k === "path" || k === "loop" || k === "delay") return "logic";
  return "action";
}

export const GOOGLE_SLUGS = new Set(["gmail", "google-sheets", "google-calendar", "google-drive"]);

export function isGoogleApp(slug: string) {
  return GOOGLE_SLUGS.has(slug);
}

export function libraryGroup(slug: string): "Triggers" | "Flow" | "AI" | "Developer" | "Apps" {
  if (["webhook", "schedule", "manual", "forms"].includes(slug)) return "Triggers";
  if (["filter", "paths", "loop", "delay", "formatter", "digest", "storage", "email-parser", "transfer", "rss"].includes(slug)) return "Flow";
  if (["openai", "anthropic", "gemini", "ai-guardrails", "ai"].includes(slug)) return "AI";
  if (["http", "code", "subflow"].includes(slug)) return "Developer";
  return "Apps";
}

export function mergeCatalog(apps?: CatalogApp[] | null): CatalogApp[] {
  const incoming = (apps ?? []).filter((a) => a?.slug);
  if (incoming.length >= 8) return incoming;
  const seen = new Set(incoming.map((a) => a.slug));
  return [...incoming, ...FALLBACK_APPS.filter((a) => !seen.has(a.slug))];
}

const FALLBACK_APPS: CatalogApp[] = [
  { slug: "webhook", name: "Webhooks", category: "developer", authType: "none", operations: [{ key: "catch_hook", name: "Catch Hook", type: "trigger" }, { key: "send_hook", name: "Send Webhook", type: "action" }] },
  { slug: "schedule", name: "Schedule", category: "core", authType: "none", operations: [{ key: "cron", name: "Cron", type: "trigger" }] },
  { slug: "manual", name: "Manual", category: "core", authType: "none", operations: [{ key: "button", name: "Manual Trigger", type: "trigger" }] },
  { slug: "gmail", name: "Gmail", category: "communication", authType: "oauth2", operations: [{ key: "new_email", name: "New Email", type: "trigger" }, { key: "send_email", name: "Send Email", type: "action" }] },
  { slug: "google-sheets", name: "Google Sheets", category: "productivity", authType: "oauth2", operations: [{ key: "new_row", name: "New Row", type: "trigger" }, { key: "create_row", name: "Create Row", type: "action" }] },
  { slug: "google-calendar", name: "Google Calendar", category: "productivity", authType: "oauth2", operations: [{ key: "new_event", name: "New Event", type: "trigger" }, { key: "create_event", name: "Create Event", type: "action" }] },
  { slug: "slack", name: "Slack", category: "communication", authType: "oauth2", operations: [{ key: "new_message", name: "New Message", type: "trigger" }, { key: "send_message", name: "Send Message", type: "action" }] },
  { slug: "http", name: "HTTP", category: "developer", authType: "none", operations: [{ key: "request", name: "HTTP Request", type: "action" }] },
  { slug: "openai", name: "OpenAI", category: "ai", authType: "api_key", operations: [{ key: "write", name: "Write", type: "action" }, { key: "extract", name: "Extract", type: "action" }] },
  { slug: "filter", name: "Filter", category: "flow", authType: "none", operations: [{ key: "only_continue_if", name: "Only continue if", type: "action" }] },
  { slug: "paths", name: "Paths", category: "flow", authType: "none", operations: [{ key: "router", name: "Paths", type: "action" }] },
  { slug: "loop", name: "Loop", category: "flow", authType: "none", operations: [{ key: "for_each", name: "For each", type: "action" }] },
  { slug: "delay", name: "Delay", category: "flow", authType: "none", operations: [{ key: "for", name: "Delay For", type: "action" }] },
  { slug: "approval", name: "Human in the Loop", category: "flow", authType: "none", operations: [{ key: "approve", name: "Ask for approval", type: "action" }] },
  { slug: "formatter", name: "Formatter", category: "utilities", authType: "none", operations: [{ key: "text", name: "Text", type: "action" }] },
  { slug: "tables", name: "Tables", category: "data", authType: "none", operations: [{ key: "new_record", name: "New Record", type: "trigger" }, { key: "create_record", name: "Create Record", type: "action" }] },
  { slug: "forms", name: "Forms", category: "data", authType: "none", operations: [{ key: "submitted", name: "New Submission", type: "trigger" }] },
  { slug: "code", name: "Code", category: "developer", authType: "none", operations: [{ key: "javascript", name: "Run JavaScript", type: "action" }] },
  { slug: "asana", name: "Asana", category: "productivity", authType: "oauth2", operations: [{ key: "new_task", name: "New Task", type: "trigger" }, { key: "create_task", name: "Create Task", type: "action" }] },
  { slug: "outlook", name: "Outlook", category: "communication", authType: "oauth2", operations: [{ key: "new_email", name: "New Email", type: "trigger" }, { key: "send_email", name: "Send Email", type: "action" }] }
];

export function flattenSample(obj: unknown, prefix = ""): string[] {
  if (obj === null || obj === undefined) return prefix ? [prefix] : [];
  if (typeof obj !== "object") return [prefix];
  if (Array.isArray(obj)) return flattenSample(obj[0] ?? {}, prefix ? `${prefix}[0]` : "[0]");
  const entries = Object.entries(obj as Record<string, unknown>);
  if (!entries.length) return prefix ? [prefix] : [];
  return entries.flatMap(([k, v]) => flattenSample(v, prefix ? `${prefix}.${k}` : k));
}
