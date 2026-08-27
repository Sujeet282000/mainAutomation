import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./config";

export const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });

export const queues = {
  executions: new Queue("executions", { connection }),
  exec: new Queue("executions", { connection }),
  delay: new Queue("delay", { connection }),
  steps: new Queue("steps", { connection }),
  webhooks: new Queue("webhooks", { connection }),
  hooks: new Queue("hooks", { connection }),
  schedules: new Queue("schedules", { connection }),
  retries: new Queue("retries", { connection }),
  ai: new Queue("ai", { connection }),
  usage: new Queue("usage", { connection }),
  poll: new Queue("poll", { connection })
};

export async function enqueueExecution(data: {
  executionId: string;
  workspaceId: string;
  orgId?: string;
  delayMs?: number;
}) {
  await queues.executions.add(
    "run",
    { executionId: data.executionId, workspaceId: data.workspaceId, orgId: data.orgId },
    {
      jobId: `${data.executionId}:${data.delayMs ? "resume" : "start"}:${Date.now()}`,
      delay: data.delayMs,
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000
    }
  );
}
