// =============================================================================
// Rate limiter — Redis-backed fixed-window primitive (P0 #8).
//
// Three scoping levels per the platform roadmap:
//   workspace   → `ws`   : max executions per window
//   connection  → `conn` : per-connection API budget
//   integration → `app`  : per-app upstream budget
//
// Uses the shared Redis client (fail-open design mirrors cache.ts so a Redis
// outage never blocks executions — the in-process webhook limiter remains as
// the last-resort guard).
// =============================================================================

import IORedis from "ioredis";
import { env } from "./config";

const redis = new IORedis(env.redisUrl, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  lazyConnect: true,
});

let ready = false;
void redis.connect().then(() => { ready = true; }).catch(() => { ready = false; });
redis.on("error", () => { ready = false; });
redis.on("ready", () => { ready = true; });

export type RateLimitScope = "ws" | "conn" | "app";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** Seconds until the window resets (for Retry-After / backoff). */
  resetAfterSec: number;
};

/**
 * Consume one unit from a fixed-window bucket. Safe to call concurrently —
 * INCR + EXPIRE(NX) is atomic per key on the Redis side.
 */
export async function consumeRateLimit(
  scope: RateLimitScope,
  id: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const resetAfterSec = windowSec;
  if (!ready || limit <= 0) {
    // Fail open: no Redis or disabled limit → allow but report honestly.
    return { allowed: true, remaining: Number.POSITIVE_INFINITY, limit, resetAfterSec };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSec / windowSec);
  const key = `rl:${scope}:${id}:${bucket}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec + 1);
    const remaining = Math.max(0, limit - count);
    return {
      allowed: count <= limit,
      remaining,
      limit,
      resetAfterSec: (bucket + 1) * windowSec - nowSec,
    };
  } catch {
    return { allowed: true, remaining: Number.POSITIVE_INFINITY, limit, resetAfterSec };
  }
}

/** Defaults — env-tunable, mirroring the webhook-ingress in-memory limits. */
export const RATE_LIMITS = {
  webhookPerToken: { limit: Number(process.env.RATE_LIMIT_WEBHOOK_PER_MIN ?? 100), windowSec: 60 },
  executionsPerWorkspace: { limit: Number(process.env.RATE_LIMIT_EXECUTIONS_PER_MIN ?? 600), windowSec: 60 },
};
