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

  const cursor = trigger.poll_cursor ?? {};
  const result = await runAdapter({
    appSlug,
    operation,
    input: { ...(triggerDef?.props ?? {}), cursor },
    auth: auth as Record<string, unknown>,
    workspaceId: trigger.org_id,
    executionId: `poll:${trigger.id}`,
    connectionId: trigger.connection_id ?? undefined,
  });

  const seen = String((cursor as Record<string, unknown>).lastId ?? "");
  const id = String((result.output as Record<string, unknown>)?.id ?? (result.output as Record<string, unknown>)?.messageId ?? "");
  let fired = 0;
  if (id && id !== seen) {
    if (seen) {
      await createAndRunFlow({
        orgId: trigger.org_id,
        flowId: trigger.flow_id,
        userId: "scheduler",
        triggerKind: "polling",
        payload: result.output as Record<string, unknown>,
        idempotencyKey: `poll:${trigger.flow_id}:${id}`,
      });
      fired += 1;
    }
  }
  await query(
    `UPDATE triggers_registry SET poll_cursor = $2::jsonb, updated_at = now() WHERE id = $1`,
    [trigger.id, JSON.stringify({ lastId: id || seen, polledAt: new Date().toISOString() })],
  );
  return fired;
}
