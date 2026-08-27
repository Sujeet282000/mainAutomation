import { setTimeout as sleep } from "node:timers/promises";

const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const SCHEDULER_SECRET = process.env.SCHEDULER_SECRET;
const TICK_MS = Math.max(5_000, Number(process.env.SCHEDULER_TICK_MS ?? 60_000));

export function nextCronTick(now = Date.now()) {
  return now - (now % 60_000) + 60_000;
}

async function tick(): Promise<void> {
  if (!SCHEDULER_SECRET) {
    throw new Error("SCHEDULER_SECRET is required for the scheduler service");
  }
  const response = await fetch(`${API_URL}/internal/scheduler/tick`, {
    method: "POST",
    headers: { authorization: `Bearer ${SCHEDULER_SECRET}` },
  });
  if (!response.ok) {
    throw new Error(`Scheduler tick failed: HTTP ${response.status}`);
  }
  const result = (await response.json()) as { scheduled?: number; polled?: number };
  console.log(JSON.stringify({ service: "scheduler", ...result, at: new Date().toISOString() }));
}

async function main() {
  console.log(JSON.stringify({ service: "scheduler", nextTick: new Date(nextCronTick()).toISOString() }));
  while (true) {
    const started = Date.now();
    try {
      await tick();
    } catch (error) {
      console.error("scheduler tick", error);
    }
    await sleep(Math.max(1_000, TICK_MS - (Date.now() - started)));
  }
}

if (require.main === module) {
  void main();
}
