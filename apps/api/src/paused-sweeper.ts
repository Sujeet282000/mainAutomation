// =============================================================================
// Paused-run sweeper (Phase 1 durability).
//
// Delay/approval pauses set flow_runs.resume_at and schedule a BullMQ delayed
// resume job. That job can be lost (Redis restart with no persistence, job
// evicted, worker crash after DB pause but before enqueue). The sweeper is the
// durable backstop: every scheduler tick it finds paused runs whose
// resume_at <= now and re-enqueues them. Idempotent — the engine's epoch-based
// claimTransition/resumeClaim already dedupes concurrent resumes.
//
// Approval timeouts are enforced here too: onTimeout approve/reject/fail from
// the approval schema decides what happens to runs past their deadline.
// =============================================================================

import { query } from "./db";
import { enqueueFlowResume } from "./queue";

export async function sweepPausedRuns(): Promise<number> {
  // 1. Due delayed runs: resume_at has passed and they're still paused.
  const due = await query<{ id: string; org_id: string; workspace_id: string; paused_reason: string | null; cursor: number | null }>(
    `SELECT id, org_id, workspace_id, paused_reason, cursor
     FROM flow_runs
     WHERE status = 'paused' AND paused_reason = 'delay' AND resume_at IS NOT NULL AND resume_at <= now()
     LIMIT 200`,
  );  let resumed = 0;
  for (const run of due) {
    // Canonical resume: atomic paused→running claim + "flow-steps" enqueue.
    // The old path resumed flow_runs through the legacy "executions" queue,
    // whose handler looks runs up in the wrong table (missing execution).
    const ok = await enqueueFlowResume(run.id, run.org_id).catch(() => false);
    if (!ok) continue; // another sweeper/worker won the race
    resumed += 1;
  }

  // 2. Approval timeouts: pending todos past their deadline get resolved by
  //    their configured onTimeout policy, then the run resumes or fails.
  const overdue = await query<{ id: string; run_id: string; org_id: string; workspace_id: string; payload_json: { onTimeout?: string } | null }>(
    `SELECT t.id, t.run_id, t.org_id, r.workspace_id, t.payload_json
     FROM todos t
     JOIN flow_runs r ON r.id = t.run_id
     WHERE t.status = 'pending'
       AND t.payload_json->>'timeoutHours' IS NOT NULL
       AND t.created_at + make_interval(hours => (t.payload_json->>'timeoutHours')::int) <= now()
     LIMIT 100`,
  );

  for (const todo of overdue) {
    const onTimeout = todo.payload_json?.onTimeout ?? "reject";
    const resolved = await query(
      `UPDATE todos SET status = $3, resolution = $4, resolved_at = now()
       WHERE id = $1 AND org_id = $2 AND status = 'pending'`,
      [todo.id, todo.org_id, onTimeout === "approve" ? "approved" : "rejected", JSON.stringify({ autoResolved: "timeout" })],
    );
    if (!resolved.length) continue;

    if (onTimeout === "approve") {
      await enqueueFlowResume(todo.run_id, todo.org_id).catch(() => undefined);
    } else {
      await query(
        `UPDATE flow_runs SET status = 'failed', paused_reason = NULL, finished_at = now()
         WHERE id = $1 AND status = 'paused'`,
        [todo.run_id],
      );
    }
  }

  return resumed;
}
