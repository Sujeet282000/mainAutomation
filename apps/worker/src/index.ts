import { Queue, Worker } from "bullmq";
import { connection } from "../../api/src/queue";
import { db } from "@algoverge/db";
import { Executor } from "@algoverge/engine";

const transitionQueue = new Queue("flow-steps", { connection });
const executor = new Executor(db, { flowStep: transitionQueue }, new Map());

const worker = new Worker(
  "flow-steps",
  async (job) => {
    const runId = String(job.data.runId);
    const cursor = Number(job.data.cursor ?? 0);
    const epoch = Number(job.data.epoch ?? 1);
    await executor.transition(runId, cursor, epoch);
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 25) },
);

worker.on("completed", (job) => console.log(`Flow run ${job.data.runId} transition completed`));
worker.on("failed", (job, err) => console.error(`Flow run ${job?.data?.runId ?? "unknown"} failed`, err));
worker.on("error", (err) => console.error("Worker error", err));

console.log("Worker listening on flow-steps queue");

const shutdown = async () => {
  await worker.close();
  await transitionQueue.close();
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
