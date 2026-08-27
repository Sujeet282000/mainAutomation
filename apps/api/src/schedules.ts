import type { WorkflowGraph } from "@algoverge/shared";
import { nextCronUtc } from "./cron";
import { query, queryOne } from "./db";
import { createExecution } from "./engine";

export async function syncScheduleFromGraph(opts: {
  automationId: string;
  workspaceId: string;
  graph: WorkflowGraph;
  enabled: boolean;
}) {
  const trigger = opts.graph.nodes.find((n) => n.type === "trigger" && n.appSlug === "schedule");
  await query(`delete from automation_schedules where automation_id=$1`, [opts.automationId]);
  if (!trigger || !opts.enabled) return;
  const cron = String(trigger.config?.cron ?? "0 * * * *");
  const timezone = String(trigger.config?.timezone ?? "UTC");
  const next = nextCronUtc(cron, new Date());
  await query(
    `insert into automation_schedules (workspace_id, automation_id, cron, timezone, next_run_at, enabled)
     values ($1,$2,$3,$4,$5,true)`,
    [opts.workspaceId, opts.automationId, cron, timezone, next.toISOString()]
  );
}

export async function tickSchedules() {
  const due = await query<{ id: string; automation_id: string; cron: string; next_run_at: string }>(
    `select id, automation_id, cron, next_run_at from automation_schedules
     where enabled = true and next_run_at <= now()`
  );
  for (const row of due) {
    const next = nextCronUtc(row.cron, new Date());
    await query(`update automation_schedules set next_run_at=$2 where id=$1`, [row.id, next.toISOString()]);
    await createExecution({
      automationId: row.automation_id,
      triggerType: "schedule",
      triggerData: { scheduledFor: new Date().toISOString() },
      idempotencyKey: `sched:${row.automation_id}:${row.next_run_at}`
    });
  }
  return due.length;
}

export async function loadPublishedGraph(automationId: string) {
  return queryOne<{ graph: WorkflowGraph }>(
    `select v.graph from automations a join automation_versions v on v.id=a.published_version_id where a.id=$1`,
    [automationId]
  );
}
