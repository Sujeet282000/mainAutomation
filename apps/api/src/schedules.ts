import { query } from "./db";
import { createAndRunFlow } from "./flow-runtime";
import { nextCronUtc } from "./cron";

// =============================================================================
// Scheduler tick (canonical).
//
// Schedule triggers live in triggers_registry (kind='schedule', cron_expr,
// next_poll_at) — written by TriggerActivationService at publish time. The
// legacy automation_schedules table is never written by the canonical publish
// path, so ticks against it silently did nothing.
//
// Dispatch goes through createAndRunFlow, the ONE canonical entrypoint that
// creates the flow_run from the PUBLISHED version and enqueues on the
// "flow-steps" queue consumed by the durable worker. The legacy
// createExecution() wrote rows into the dead "executions" table whose handler
// executes against the wrong schema.
//
// Claim-then-dispatch: next_poll_at is advanced BEFORE dispatch so concurrent
// tick callers (multiple API replicas) claim disjoint batches; a failed
// dispatch leaves the trigger due again on the next tick (now + 1 min).
// =============================================================================

const SCHEDULE_RETRY_DELAY_MS = 60_000;

export async function tickSchedules(): Promise<number> {
  const due = await query<{ id: string; org_id: string; flow_id: string; cron_expr: string; timezone: string; next_poll_at: string }>(
    `UPDATE triggers_registry
     SET next_poll_at = now() + make_interval(secs => $1::numeric),
         updated_at = now()
     WHERE id IN (
       SELECT id FROM triggers_registry
       WHERE enabled = true AND status = 'active' AND kind = 'schedule' AND next_poll_at <= now()
       ORDER BY next_poll_at
       FOR UPDATE SKIP LOCKED
       LIMIT 50
     )
     RETURNING id, org_id, flow_id, cron_expr, timezone, next_poll_at`,
    [SCHEDULE_RETRY_DELAY_MS],
  );

  let fired = 0;
  for (const row of due) {
    try {
      await createAndRunFlow({
        orgId: row.org_id,
        flowId: row.flow_id,
        userId: "scheduler",
        triggerKind: "scheduled",
        payload: { scheduledFor: new Date().toISOString(), cron: row.cron_expr, timezone: row.timezone },
        idempotencyKey: `sched:${row.flow_id}:${new Date(row.next_poll_at).toISOString()}`,
      });
      fired += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "schedule_dispatch_failed";
      console.warn(`[schedules] ${row.flow_id} dispatch failed: ${message}`);
      // Leave due again: reset next_poll_at so the next tick retries promptly.
      await query(`UPDATE triggers_registry SET next_poll_at = now(), updated_at = now() WHERE id = $1`, [row.id]).catch(() => {});
    }
    // Success path: advance by cron so the next occurrence is computed from now.
    await query(`UPDATE triggers_registry SET next_poll_at = $2, updated_at = now() WHERE id = $1 AND kind = 'schedule'`, [
      row.id,
      nextCronUtc(row.cron_expr || "0 * * * *", new Date()).toISOString(),
    ]).catch(() => {});
  }
  return fired;
}
