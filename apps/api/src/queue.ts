import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./config";
import { query } from "./db";

export const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });

// One canonical execution path: createAndRunFlow() commits a flow_run row and
// enqueues on "flow-steps"; the worker's Executor consumes that queue. The
// retired legacy queues (executions/delay/steps/webhooks/hooks/schedules/
// retries/ai/usage/poll) had no canonical producers or consumers.
export const queues = {
  flowSteps: new Queue("flow-steps", { connection })
};

/**
 * Schedule a resume for a paused canonical (flow_runs) run through the
 * canonical worker/engine boundary: enqueue a "resume" job on the
 * "flow-steps" queue, which the worker answers by calling
 * Executor.resume() — whose resumeClaim() does the ATOMIC paused→running
 * flip (+epoch bump). The API must NOT flip the status itself: claiming
 * here would make the engine's resumeClaim() a no-op and strand the run.
 *
 * Dedupe/first-claimer-wins semantics live entirely in the engine: duplicate
 * resume jobs (double approval click, sweeper racing a user approval) are
 * harmless because only the first resumeClaim() succeeds.
 *
 * This replaces two broken paths: approval resumes that were enqueued on a
 * queue no worker consumes ("steps"), and the paused-run sweeper that
 * resumed flow_runs through the legacy "executions" queue (whose handler
 * looks runs up in the wrong table).
 */
export async function enqueueFlowResume(runId: string, orgId: string): Promise<boolean> {
  const current = await query<{ status: string }>(
    `SELECT status FROM flow_runs WHERE id = $1 AND org_id = $2`,
    [runId, orgId],
  );
  if (current[0]?.status !== "paused") return false; // unknown run or nothing to resume
  await queues.flowSteps.add(
    "resume",
    { runId, orgId, kind: "resume" },
    // Timestamp in the jobId: a run can pause again later at the same step,
    // and a kept completed job must never suppress the next resume.
    { jobId: `resume-${runId}-${Date.now()}`, removeOnComplete: 1000, removeOnFail: 5000, attempts: 3 },
  );
  return true;
}
