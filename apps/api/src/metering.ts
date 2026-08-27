import { query } from "./db";

/** Built-in logic tools never consume a task (Zapier §23.2). Tables/Forms reads-writes are also free. */
export const FREE_TASK_APPS = new Set([
  "filter",
  "formatter",
  "paths",
  "delay",
  "loop",
  "subflow",
  "digest",
  "manager",
  "storage",
  "tables",
  "forms",
  "schedule",
  "manual",
  "approval",
  "variables",
  "ai-guardrails"
]);

export function taskUnitsForStep(opts: {
  appSlug: string;
  isTrigger: boolean;
  byok: boolean;
  aiTier?: string;
  mcp?: boolean;
}) {
  if (opts.isTrigger) return 0;
  if (FREE_TASK_APPS.has(opts.appSlug)) return 0;
  let units = 1;
  if (["openai", "anthropic", "gemini", "ai"].includes(opts.appSlug)) {
    if (opts.byok) units = 1;
    else {
      const tier = (opts.aiTier ?? "standard").toLowerCase();
      units = tier === "premium" ? 5 : tier === "advanced" ? 3 : 1;
    }
  }
  if (opts.mcp) units *= 2;
  return units;
}

export async function recordUsage(opts: {
  organizationId: string;
  workspaceId: string;
  metric: string;
  quantity: number;
  metadata?: Record<string, unknown>;
}) {
  if (opts.quantity <= 0) return;
  const key =
    opts.metric === "agent_activities" || opts.metric.includes("ai")
      ? "ai_credits"
      : opts.metric === "runs" || opts.metric === "steps" || opts.metric === "storage_bytes"
        ? opts.metric
        : "steps";
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  await query(
    `INSERT INTO usage_counters (org_id, period_start, period_end, counter_key, value)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (org_id, period_start, counter_key)
     DO UPDATE SET value = usage_counters.value + EXCLUDED.value, updated_at = now()`,
    [opts.organizationId, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), key, opts.quantity],
  ).catch(() => undefined);
}
