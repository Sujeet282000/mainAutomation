import vm from "node:vm";
import { evaluateCondition, type FilterOperator } from "@algoverge/shared";
import { query, queryOne } from "../db";
import { httpRequest } from "./http";
import { registerAdapter } from "./registry";

async function triggerPassthrough(ctx: { input: Record<string, unknown> }) {
  return { output: ctx.input };
}

registerAdapter("webhook", "catch_hook", triggerPassthrough);
registerAdapter("webhook", "send_hook", async ({ input, auth }) => {
  const headers: Record<string, string> = {};
  if (auth?.access_token) headers.authorization = `Bearer ${auth.access_token}`;
  return { output: await httpRequest({ ...input, method: input.method ?? "POST" }, headers) };
});
registerAdapter("http", "request", async ({ input }) => ({ output: await httpRequest(input) }));
registerAdapter("schedule", "cron", triggerPassthrough);
registerAdapter("manual", "button", triggerPassthrough);
registerAdapter("forms", "submitted", triggerPassthrough);
registerAdapter("tables", "new_record", triggerPassthrough);

registerAdapter("filter", "only_continue_if", async ({ input }) => {
  const ok = evaluateCondition(input.left, (input.operator as FilterOperator) ?? "equals", input.right);
  return { output: { matched: ok, left: input.left, right: input.right }, control: ok ? "continue" : "skip_rest" };
});

registerAdapter("paths", "branch", async ({ input }) => {
  const ok = evaluateCondition(input.left, (input.operator as FilterOperator) ?? "equals", input.right);
  return { output: { matched: ok }, control: "branch", branch: ok ? "true" : "false" };
});

registerAdapter("paths", "router", async ({ input }) => {
  type PathRule = { id?: string; label?: string; left?: unknown; operator?: string; right?: unknown; fallback?: boolean };
  const rules: PathRule[] = Array.isArray(input.paths)
    ? (input.paths as PathRule[])
    : [
        { id: "path-a", left: input.left, operator: String(input.operator ?? "equals"), right: input.right },
        { id: "path-b", fallback: true }
      ];
  const matched: string[] = [];
  for (const rule of rules) {
    if (rule.fallback) continue;
    const id = String(rule.id ?? "path-a");
    if (evaluateCondition(rule.left ?? input.left, (rule.operator as FilterOperator) ?? "equals", rule.right ?? input.right)) {
      matched.push(id);
    }
  }
  if (!matched.length) {
    const fallback = rules.find((r) => r.fallback);
    if (fallback?.id) matched.push(String(fallback.id));
  }
  return { output: { matched }, control: "paths", matchedHandles: matched };
});

registerAdapter("loop", "for_each", async ({ input }) => {
  let items: unknown = input.items;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch {
      items = String(input.items)
        .split(",")
        .map((s) => s.trim());
    }
  }
  const arr = Array.isArray(items) ? items : [];
  return { output: { count: arr.length, items: arr }, loopItems: arr };
});

async function delayHandler({ input }: { input: Record<string, unknown> }) {
  const amount = Number(input.amount ?? 1);
  const unit = String(input.unit ?? "seconds");
  const mult = unit === "days" ? 86400000 : unit === "hours" ? 3600000 : unit === "minutes" ? 60000 : 1000;
  return { output: { delayed: true, amount, unit }, control: "wait" as const, waitMs: amount * mult };
}
registerAdapter("delay", "for", delayHandler);
registerAdapter("delay", "wait", delayHandler);
registerAdapter("delay", "until", async ({ input }) => {
  const at = new Date(String(input.at ?? "")).getTime();
  if (!Number.isFinite(at)) throw new Error("Delay Until requires a valid ISO datetime.");
  return { output: { until: input.at }, control: "wait" as const, waitMs: Math.max(0, at - Date.now()) };
});

registerAdapter("formatter", "text", async ({ input }) => {
  const raw = String(input.input ?? "");
  const transform = String(input.transform ?? "trim");
  let value: unknown = raw;
  if (transform === "upper") value = raw.toUpperCase();
  if (transform === "lower") value = raw.toLowerCase();
  if (transform === "trim") value = raw.trim();
  if (transform === "title") value = raw.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  if (transform === "split") value = raw.split(String(input.separator ?? ","));
  if (transform === "replace") value = raw.split(String(input.find ?? "")).join(String(input.replaceWith ?? ""));
  if (transform === "extract_email") value = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  if (transform === "extract_number") value = raw.match(/-?\d+(\.\d+)?/)?.[0] ?? "";
  return { output: { value } };
});

registerAdapter("formatter", "date", async ({ input }) => {
  const d = new Date(String(input.input ?? Date.now()));
  d.setHours(d.getHours() + Number(input.offsetHours ?? 0));
  return { output: { iso: d.toISOString(), unix: Math.floor(d.getTime() / 1000) } };
});

registerAdapter("formatter", "number", async ({ input }) => {
  const a = Number(input.a ?? 0);
  const b = Number(input.b ?? 0);
  const op = String(input.op ?? "add");
  const value = op === "sub" ? a - b : op === "mul" ? a * b : op === "div" ? a / (b || 1) : op === "round" ? Math.round(a) : a + b;
  return { output: { value } };
});

registerAdapter("code", "javascript", async ({ input, auth }) => {
  const sandbox = { input, auth: { connected: Boolean(auth) }, result: undefined as unknown };
  vm.runInNewContext(`${String(input.code ?? "result = input")};`, sandbox, { timeout: 1500 });
  return { output: { result: sandbox.result ?? sandbox } };
});

async function ownedTable(tableId: unknown, workspaceId: string) {
  const table = await queryOne<{ id: string }>(`select id from data_tables where id=$1 and workspace_id=$2`, [tableId, workspaceId]);
  if (!table) throw new Error("Table is unavailable in this workspace.");
  return table;
}

registerAdapter("tables", "create_record", async ({ input, workspaceId }) => {
  await ownedTable(input.tableId, workspaceId);
  const row = await queryOne(`insert into table_records (table_id, data) values ($1,$2) returning *`, [input.tableId, JSON.stringify(input.data ?? {})]);
  return { output: row ?? {} };
});

registerAdapter("tables", "find_record", async ({ input, workspaceId }) => {
  await ownedTable(input.tableId, workspaceId);
  const q = input.query as Record<string, unknown> | undefined;
  const rows = await query<{ id: string; data: Record<string, unknown> }>(
    `select * from table_records where table_id=$1 order by created_at desc limit 50`,
    [input.tableId]
  );
  if (!q || Object.keys(q).length === 0) return { output: rows[0] ?? {} };
  const match = rows.find((row) =>
    Object.entries(q).every(([k, v]) => String((row.data ?? {})[k] ?? "") === String(v))
  );
  return { output: match ?? {} };
});

registerAdapter("tables", "update_record", async ({ input, workspaceId }) => {
  await ownedTable(input.tableId, workspaceId);
  const row = await queryOne(
    `update table_records set data = coalesce(data,'{}'::jsonb) || $3::jsonb where id=$1 and table_id=$2 returning *`,
    [input.recordId, input.tableId, JSON.stringify(input.data ?? {})]
  );
  if (!row) throw new Error("Table record not found.");
  return { output: row };
});

registerAdapter("tables", "delete_record", async ({ input, workspaceId }) => {
  await ownedTable(input.tableId, workspaceId);
  const deleted = await queryOne(`delete from table_records where id=$1 and table_id=$2 returning id`, [input.recordId, input.tableId]);
  if (!deleted) throw new Error("Table record not found.");
  return { output: { deleted: true, recordId: input.recordId } };
});

registerAdapter("approval", "approve", async ({ input, executionId }) => {
  await query(
    `insert into approvals (organization_id, workspace_id, execution_id, step_id, payload, deadline)
     select e.organization_id, e.workspace_id, e.id, $2, $3, now() + ($4 || ' hours')::interval
     from executions e where e.id=$1`,
    [executionId, "approval", JSON.stringify({ message: input.message }), String(input.deadlineHours ?? 24)]
  );
  return {
    output: { status: "pending_approval", message: input.message },
    control: "wait",
    hold: true
  };
});

registerAdapter("subflow", "call", async ({ input }) => {
  return {
    output: {
      queued: true,
      automationId: input.automationId,
      note: "Subflow enqueue is handled by the engine when this adapter is invoked from a published graph."
    }
  };
});
