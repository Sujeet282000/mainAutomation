// =============================================================================
// Orchestra Part 6 — Webhook Ingress
// Source of truth: Part 6 § "Webhook ingress on Fastify"
//
// The ONE production webhook execution path. Authenticates the raw payload
// (providers sign original bytes), looks up the opaque token, rejects replayed
// events, durably claims a flow_run via createAndRunFlow, then acknowledges.
// Never runs a flow inline and never double-writes to another queue.
// =============================================================================

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { query, queryOne } from "../db";
import { consumeRateLimit, RATE_LIMITS } from "../rate-limit";
import { cacheGet, cacheSet } from "../cache";

export const webhookRouter = Router();

// Rate limiting: Redis fixed-window primary, in-process sliding window as
// fallback when Redis is unreachable (single-replica dev / degraded mode).
const rateLimit = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = RATE_LIMITS.webhookPerToken.limit;

function checkRateMemory(token: string): boolean {
  const now = Date.now();
  const timestamps = rateLimit.get(token) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) return false;
  recent.push(now);
  rateLimit.set(token, recent);
  return true;
}

async function checkRate(token: string): Promise<boolean> {
  const result = await consumeRateLimit("ws", `webhook:${token}`, RATE_LIMITS.webhookPerToken.limit, RATE_LIMITS.webhookPerToken.windowSec);
  // Redis answered (finite remaining ⇒ real answer) — trust it.
  if (Number.isFinite(result.remaining)) return result.allowed;
  return checkRateMemory(token);
}

// Track seen event IDs for dedup — Redis primary (survives restarts and is
// shared across replicas), in-process TTL map as fallback.
const seenEvents = new Map<string, number>();
const SEEN_TTL_MS = 300_000;

function isDuplicateMemory(eventId: string): boolean {
  const now = Date.now();
  // Cleanup old entries
  if (seenEvents.size > 10000) {
    for (const [key, ts] of seenEvents) {
      if (now - ts > SEEN_TTL_MS) seenEvents.delete(key);
    }
  }

  if (seenEvents.has(eventId)) return true;
  seenEvents.set(eventId, now);
  return false;
}

async function isDuplicate(eventId: string): Promise<boolean> {
  const key = `webhook:seen:${eventId}`;
  const existing = await cacheGet<number>(key);
  if (existing) return true;
  // Record the event in Redis (no-op when Redis is down) and in the
  // in-process fallback map, then let the map decide for this call.
  // A cross-replica race is resolved by the DB idempotency claim downstream
  // (trigger_events ON CONFLICT DO NOTHING).
  await cacheSet(key, Date.now(), Math.ceil(SEEN_TTL_MS / 1000));
  return isDuplicateMemory(eventId);
}

/** Length-safe constant-time hex comparison (timingSafeEqual throws on length mismatch). */
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// POST /v1/webhooks/inbound/:token
webhookRouter.post("/v1/webhooks/inbound/:token", async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const startTime = Date.now();

  try {
    // 1. Look up trigger registration by webhook token
    const trigger = await queryOne<{
      id: string;
      org_id: string;
      flow_id: string;
      flow_version_id: string;
      piece_name: string;
      operation_id: string;
      connection_id: string | null;
      webhook_secret_hash: Buffer | null;
    }>(
      `SELECT id, org_id, flow_id, flow_version_id, piece_name, operation_id, connection_id, webhook_secret_hash
       FROM triggers_registry
       WHERE webhook_token = $1 AND status = 'active' AND kind = 'webhook'`,
      [token],
    );

    if (!trigger) {
      return res.status(404).json({ error: "webhook_not_found" });
    }

    // 2. Rate limit check (Redis primary, in-memory fallback)
    if (!(await checkRate(token))) {
      return res.status(429).json({ error: "rate_limited" });
    }

    // 3. Optional HMAC signature verification against the stored secret.
    // The secret is persisted (base64) in webhook_secret_hash by the
    // activation service; providers sign the ORIGINAL bytes, which index.ts
    // preserves on req.rawBody for this route.
    if (trigger.webhook_secret_hash) {
      const signature = String(req.headers["x-webhook-signature"] ?? "").replace(/^sha256=/i, "");
      if (!signature) {
        return res.status(401).json({ error: "missing_signature" });
      }

      const rawBody = req.rawBody?.length
        ? req.rawBody
        : Buffer.from(JSON.stringify(req.body ?? {}));
      const expected = crypto
        .createHmac("sha256", trigger.webhook_secret_hash)
        .update(rawBody)
        .digest("hex");

      if (!safeEqualHex(expected, signature)) {
        return res.status(401).json({ error: "invalid_signature" });
      }
    }

    // 4. Extract event ID for dedup (provider-specific)
    const eventId =
      (req.headers["x-webhook-id"] as string) ||
      (req.headers["x-event-id"] as string) ||
      (req.headers["x-github-delivery"] as string) ||
      null;

    if (eventId && (await isDuplicate(eventId))) {
      // Already processed — return 200 so the provider stops retrying.
      return res.status(200).json({ ok: true, deduplicated: true });
    }

    // 5. Dispatch through the ONE canonical execution path. createAndRunFlow
    // durably claims the run (trigger_events idempotency + flow_runs row)
    // before this handler acknowledges; the worker owns execution. No
    // secondary queue write — the flow-steps enqueue happens inside
    // createAndRunFlow.
    const payload = (req.body && typeof req.body === "object" ? req.body : { body: req.body }) as Record<string, unknown>;
    const member = await queryOne<{ user_id: string }>(
      `SELECT user_id FROM org_members WHERE org_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [trigger.org_id],
    );
    if (!member) {
      console.error(`Webhook ingress: no member found for org ${trigger.org_id}`);
      return res.status(500).json({ error: "org_unconfigured" });
    }

    try {
      const { createAndRunFlow } = await import("../flow-runtime");
      await createAndRunFlow({
        orgId: trigger.org_id,
        flowId: trigger.flow_id,
        userId: member.user_id,
        payload,
        triggerKind: "webhook",
        eventId,
        idempotencyKey: eventId ? `webhook:${trigger.flow_id}:${eventId}` : undefined,
        receivedAt: new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "dispatch_failed";
      // Duplicate idempotency claims are success (the run already exists).
      if (message === "TRIGGER_EVENT_CLAIM_INCOMPLETE") throw err;
      const duplicate = message.includes("duplicate key") && message.includes("trigger_events");
      if (duplicate) {
        const ackMs = Date.now() - startTime;
        return res.status(200).json({ ok: true, deduplicated: true, ackMs });
      }
      throw err;
    }

    // 6. Acknowledge with 202: accepted, execution is asynchronous.
    const ackMs = Date.now() - startTime;
    return res.status(202).json({ ok: true, eventId, ackMs });
  } catch (err) {
    console.error("Webhook ingress error:", err);
    // 5xx so the provider retries. Idempotent handling (event dedup + the
    // trigger_events claim) makes those retries safe.
    return res.status(500).json({ error: "internal_error" });
  }
});
