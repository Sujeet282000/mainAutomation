import type { WorkflowGraph } from "@algoverge/shared";
import { getApp } from "./catalog/catalog";
import { loadConnectionSecret, createAndRunFlow } from "./flow-runtime";
import { query, queryOne } from "./db";
import { runAdapter } from "./adapters";

// =============================================================================
// Polling trigger tick (canonical).
//
// Active app_event triggers are registered in triggers_registry by
// TriggerActivationService at publish time (kind='app_event',
// connection_id, poll_cursor, next_poll_at). The legacy poll.ts queried the
// dead automations/automation_versions tables, so polling triggers never ran.
//
// Dispatch goes through createAndRunFlow (canonical durable path) with a
// deterministic idempotency key per polled event id, and the registry row
// claims the batch first (FOR UPDATE SKIP LOCKED) so concurrent ticks never
// double-poll the same trigger.
// =============================================================================

const POLL_BATCH_SIZE = 20;
const POLL_RETRY_DELAY_S = 60;

type Claimed = {
  id: string;
  org_id: string;
  flow_id: string;
  flow_version_id: string;
  operation_id: string | null;
  connection_id: string | null;
  piece_name: string | null;
  poll_cursor: Record<string, unknown> | null;
};

export async function tickPolling(): Promise<number> {
  const claimed = await query<Claimed>(
    `UPDATE triggers_registry
     SET next_poll_at = now() + make_interval(secs => $2::numeric),
         updated_at = now()
     WHERE id IN (
       SELECT id FROM triggers_registry
       WHERE enabled = true AND status = 'active' AND kind = 'app_event' AND next_poll_at <= now()
       ORDER BY next_poll_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     RETURNING id, org_id, flow_id, flow_version_id, operation_id, connection_id, piece_name, poll_cursor`,
    [POLL_BATCH_SIZE, POLL_RETRY_DELAY_S],
  );

  let fired = 0;
  for (const trigger of claimed) {
    try {
      fired += await pollTrigger(trigger);
    } catch (err) {
      const message = err instanceof Error ? err.message : "poll_failed";
      console.warn(`[poll] ${trigger.flow_id} (${trigger.piece_name}.${trigger.operation_id}) failed: ${message}`);
      // Leave due again for the next tick.
      await query(`UPDATE triggers_registry SET next_poll_at = now(), updated_at = now() WHERE id = $1`, [trigger.id]).catch(() => {});
    }
  }
  return fired;
}

async function pollTrigger(trigger: Claimed): Promise<number> {
  const version = await queryOne<{ definition: { trigger?: { piece?: { name?: string }; operation?: string; connectionId?: string | null; props?: Record<string, unknown> } } }>(
    `SELECT definition FROM flow_versions WHERE id = $1`,
    [trigger.flow_version_id],
  );
  const triggerDef = version?.definition?.trigger;
  const appSlug = triggerDef?.piece?.name ?? trigger.piece_name;
  const operation = triggerDef?.operation ?? trigger.operation_id;
  if (!appSlug || !operation) return 0;

  const app = getApp(appSlug);
  const op = app?.operations.find((o) => o.key === operation);
  if (op?.triggerMode !== "polling") return 0;

  const auth = triggerDef?.connectionId
    ? await loadConnectionSecret(triggerDef.connectionId, trigger.org_id)
    : trigger.connection_id
      ? await loadConnectionSecret(trigger.connection_id, trigger.org_id)
      : null;
  if (!auth) {
    console.warn(`[poll] Skipped ${trigger.flow_id}: no connected account for ${appSlug}.`);
    return 0;
  }

  const cursor = (trigger.poll_cursor ?? {}) as Record<string, unknown>;
  const result = await runAdapter({
    appSlug,
    operation,
    input: { ...(triggerDef?.props ?? {}), cursor },
    auth: auth as Record<string, unknown>,
    workspaceId: trigger.org_id,
    executionId: `poll:${trigger.id}`,
    connectionId: trigger.connection_id ?? undefined,
  });

  const output = (result.output ?? {}) as Record<string, unknown>;
  const seen = String(cursor.lastId ?? "");
  // Adapters can return either a single event ({ id }) or a batch
  // ({ id: newestId, items: [...] }). Fire one run per unseen event so
  // messages that arrive between two polls are not collapsed/lost.
  const batch = Array.isArray(output.items) && output.items.length ? (output.items as Array<Record<string, unknown>>) : [output];
  const events = batch
    .map((item) => ({
      id: String(item?.id ?? item?.messageId ?? ""),
      item,
    }))
    .filter((event) => event.id && event.id !== seen);
  // Oldest first so downstream runs execute in the order the events happened.
  events.reverse();

  let fired = 0;
  const seenIds = new Set<string>(seen ? [seen] : []);
  for (const event of events) {
    // Skip ids already fired by a previous poll (belt-and-braces; createAndRunFlow
    // also dedupes via the trigger_events idempotency claim).
    if (seenIds.has(event.id)) continue;
    seenIds.add(event.id);
    // The very first poll only primes the cursor — a brand-new trigger should
    // not replay the provider's entire history.
    if (!seen) break;
    await createAndRunFlow({
      orgId: trigger.org_id,
      flowId: trigger.flow_id,
      userId: "scheduler",
      triggerKind: "polling",
      payload: event.item,
      idempotencyKey: `poll:${trigger.flow_id}:${event.id}`,
    });
    fired += 1;
  }

  const newestId = String(output.id ?? events[events.length - 1]?.id ?? seen);
  await query(
    `UPDATE triggers_registry SET poll_cursor = $2::jsonb, updated_at = now() WHERE id = $1`,
    [trigger.id, JSON.stringify({ lastId: newestId || seen, polledAt: new Date().toISOString() })],
  );
  return fired;
}
