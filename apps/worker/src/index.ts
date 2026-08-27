import { Queue, Worker } from "bullmq";
import { Db, createRepositories } from "@algoverge/db";
import { Executor } from "@algoverge/engine";
import { connection } from "./redis";
import { adapterStepHandler } from "./adapter-handler";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the worker");

const db = new Db(databaseUrl);
const repositories = createRepositories(db);
const transitionQueue = new Queue("flow-steps", { connection });
const engineDb = {
  flowRuns: repositories.runs,
  flowVersions: repositories.flowVersions,
  runSteps: repositories.runSteps,
  todos: repositories.todos,
};
const executor = new Executor(engineDb, { flowStep: transitionQueue }, new Map([
  ["piece_action", adapterStepHandler],
]));

const worker = new Worker(
  "flow-steps",
  async (job) => {
    const runId = String(job.data.runId);
    const cursor = Number(job.data.cursor ?? 0);
    const epoch = Number(job.data.epoch ?? 1);
    await executor.transition(runId, cursor, epoch);
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 10) },
);

worker.on("completed", (job) => console.log(`Flow run ${job.data.runId} transition completed`));
worker.on("failed", (job, err) => console.error(`Flow run ${job?.data?.runId ?? "unknown"} failed`, err));
worker.on("error", (err) => console.error("Worker error", err));

console.log("Worker listening on flow-steps queue");

const shutdown = async () => {
  await worker.close();
  await transitionQueue.close();
  await connection.quit();
  await db.close();
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
