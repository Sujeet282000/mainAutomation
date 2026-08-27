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
const executor = new Executor(engineDb, { flowStep: transitionQueue }, new Map([
  ["piece_action", adapterStepHandler],
]));

const flowWorker = new Worker(
  "flow-steps",
  async (job) => {
    await executor.transition(
      String(job.data.runId),
      Number(job.data.cursor ?? 0),
      Number(job.data.epoch ?? 1),
    );
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 10) },
);

// Compatibility worker: existing UI/API executions continue to work while
// automations are migrated to flow_runs. It can be removed only after the
// migration is complete and no callers enqueue the legacy queue.
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

console.log("Worker listening on flow-steps and executions queues");

const shutdown = async () => {
  await Promise.all([flowWorker.close(), legacyWorker.close(), transitionQueue.close()]);
  await connection.quit();
  await db.close();
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
