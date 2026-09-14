import { setTimeout as sleep } from "node:timers/promises";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import fs from "fs";
import path from "path";
import { RedisLease } from "./lock";

// Inline .env loader (no dotenv dependency needed)
for (const envFile of [".env", ".env.local"]) {
  const p = path.resolve(__dirname, "../../../", envFile);
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
    }
  }
}

const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const SCHEDULER_SECRET = process.env.SCHEDULER_SECRET;
const TICK_MS = Math.max(5_000, Number(process.env.SCHEDULER_TICK_MS ?? 60_000));
const LOCK_TTL_MS = Math.max(TICK_MS * 2, Number(process.env.SCHEDULER_LOCK_TTL_MS ?? 120_000));
const INSTANCE_ID = process.env.SCHEDULER_INSTANCE_ID ?? `${hostname()}:${process.pid}:${randomUUID()}`;
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { lazyConnect: true, maxRetriesPerRequest: null });
const tickLease = new RedisLease(redis, "scheduler:tick:leader", LOCK_TTL_MS);

export function nextCronTick(now = Date.now()) {
  return now - (now % 60_000) + 60_000;
}

async function tick(): Promise<void> {
  if (!SCHEDULER_SECRET) {
    throw new Error("SCHEDULER_SECRET is required for the scheduler service");
  }
  const tickId = randomUUID();
  const result = await tickLease.run(async () => {
    /* Retry with short backoff: while the API dev server (tsx watch) restarts
       after a code change nothing listens on the port for a few seconds and
       every tick would otherwise log a raw ECONNREFUSED stack. 3 tries cover
       a full restart; schedule ticks are idempotent per minute so a retried
       tick cannot double-fire schedules. */
    const attempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(`${API_URL}/internal/scheduler/tick`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${SCHEDULER_SECRET}`,
            "x-scheduler-instance-id": INSTANCE_ID,
            "x-scheduler-tick-id": tickId,
          },
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error(`Scheduler tick failed: HTTP ${response.status}`);
        return (await response.json()) as { scheduled?: number; polled?: number };
      } catch (err) {
        lastError = err;
        if (attempt < attempts) await sleep(2_000 * attempt);
      }
    }
    throw lastError;
  });
  if (!result) {
    console.log(JSON.stringify({ service: "scheduler", skipped: "lease_not_acquired", instanceId: INSTANCE_ID, tickId, at: new Date().toISOString() }));
    return;
  }
  console.log(JSON.stringify({ service: "scheduler", ...result, instanceId: INSTANCE_ID, tickId, at: new Date().toISOString() }));
}

async function main() {
  try {
    await redis.connect();
    console.log(JSON.stringify({ service: "scheduler", instanceId: INSTANCE_ID, lockTtlMs: LOCK_TTL_MS, nextTick: new Date(nextCronTick()).toISOString() }));
    while (true) {
      const started = Date.now();
      try { await tick(); } catch (error) { console.error("scheduler tick", error); }
      await sleep(Math.max(1_000, TICK_MS - (Date.now() - started)));
    }
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

if (require.main === module) {
  void main();
}
