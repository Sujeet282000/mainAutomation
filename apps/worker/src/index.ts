import { Worker } from "bullmq";
import { runExecution } from "../../api/src/engine";
import { connection } from "../../api/src/queue";
import { tickSchedules } from "../../api/src/schedules";
import { tickPolling } from "../../api/src/poll";
import { isNonRetryableError } from "../../api/src/runtime-guards";

new Worker(
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
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 25) }
);

async function tick() {
  await tickSchedules();
  await tickPolling();
}

setInterval(() => {
  tick().catch((err) => console.error("schedule/poll tick", err));
}, 60_000);
tick().catch((err) => console.error("schedule/poll tick", err));

console.log("Worker listening on executions queue + schedule/poll ticker");
