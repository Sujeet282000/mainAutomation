import { Worker } from "bullmq";
import { runExecution } from "../../api/src/engine";
import { connection } from "../../api/src/queue";
import { isNonRetryableError } from "../../api/src/runtime-guards";

/**
 * Execution worker only.
 * Scheduling/polling discovery is owned by apps/scheduler and is dispatched
 * into the same BullMQ execution queue for the worker to process.
 */
const worker = new Worker(
  "executions",
  async (job) => {
    const executionId = String(job.data.executionId);
    try {
      await runExecution(executionId);
    } catch (err) {
      if (isNonRetryableError(err)) return;
      throw err;
    }
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 25) },
);

worker.on("completed", (job) => console.log(`Execution ${job.data.executionId} completed`));
worker.on("failed", (job, err) => console.error(`Execution ${job?.data?.executionId ?? "unknown"} failed`, err));
worker.on("error", (err) => console.error("Worker error", err));

console.log("Worker listening on executions queue");
