import { Queue, Worker } from "bullmq";
import { Db } from "@algoverge/db";
import { Executor } from "@algoverge/engine";
import { runExecution } from "../../api/src/engine";
import { connection } from "./redis";
import { adapterStepHandler } from "./adapter-handler";
import { createEngineDb } from "./engine-db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the worker");

const db = new Db(databaseUrl);
const transitionQueue = new Queue("flow-steps", { connection });
const engineDb = createEngineDb(db);

const canonicalLeafTypes = ["piece_action", "http", "code", "ai", "agent", "data_table"];
const handlers = new Map(canonicalLeafTypes.map((type) => [type, adapterStepHandler] as const));
const executor = new Executor(engineDb, { flowStep: transitionQueue }, handlers);

async function recoverQueuedRuns() {
  const result = await db.service.query(
    `SELECT id, cursor, transition_epoch FROM flow_runs
     WHERE status = 'queued'
     ORDER BY created_at ASC
     LIMIT 100`,
  );
  for (const row of result.rows) {
    try {
      await transitionQueue.add(
        "transition",
        { runId: String(row.id), cursor: Number(row.cursor ?? 0), epoch: Number(row.transition_epoch ?? 0) },
        { jobId: `recover-${row.id}-${row.cursor ?? 0}-${row.transition_epoch ?? 0}`, removeOnComplete: 1000, removeOnFail: 5000 },
      );
    } catch (error) {
      console.error(`Unable to recover queued flow ${row.id}`, error);
    }
  }
}

const flowWorker = new Worker(
  "flow-steps",
  async (job) => {
    const runId = String(job.data.runId);
    try {
      if (job.data.kind === "resume") {
        await executor.resume(runId);
        return;
      }
      await executor.transition(
        runId,
        Number(job.data.cursor ?? 0),
        Number(job.data.epoch ?? 0),
      );
    } catch (error) {
      // The Executor owns normal state transitions. This boundary handles
      // unexpected infrastructure/contract failures so a run can never remain
      // permanently queued/running merely because the BullMQ job failed.
      try {
        await engineDb.flowRuns.fail(runId, error);
      } catch (failError) {
        console.error(`Unable to persist failure for flow ${runId}`, failError);
      }
      throw error;
    }
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 10) },
);

const legacyWorker = new Worker(
  "executions",
  async (job) => {
    const executionId = String(job.data.executionId);
    await runExecution(executionId);
  },
  { connection, concurrency: Number(process.env.LEGACY_WORKER_CONCURRENCY ?? 5) },
);

flowWorker.on("completed", (job) => console.log(`Flow run ${job.data.runId} transition completed`));
flowWorker.on("failed", (job, err) => console.error(`Flow run ${job?.data?.runId ?? "unknown"} failed`, err));
flowWorker.on("error", (err) => console.error("Flow worker error", err));
legacyWorker.on("completed", (job) => console.log(`Legacy execution ${job.data.executionId} completed`));
legacyWorker.on("failed", (job, err) => console.error(`Legacy execution ${job?.data?.executionId ?? "unknown"} failed`, err));
legacyWorker.on("error", (err) => console.error("Legacy worker error", err));

// DB commit and Redis enqueue are intentionally separate operations. This
// lightweight sweeper closes that failure window: if the API commits a queued
// run but crashes before enqueueing, the worker discovers and enqueues it.
const recoveryTimer = setInterval(() => void recoverQueuedRuns(), 10_000);
void recoverQueuedRuns();

console.log("Worker listening on flow-steps and executions queues");

const shutdown = async () => {
  clearInterval(recoveryTimer);
  await Promise.all([flowWorker.close(), legacyWorker.close(), transitionQueue.close()]);
  await connection.quit();
  await db.close();
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
