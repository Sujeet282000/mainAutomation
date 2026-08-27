import type { WorkflowGraph } from "@algoverge/shared";
import { getApp } from "./catalog";
import { loadCompatibleConnectionAuth } from "./connections";
import { query, queryOne } from "./db";
import { createExecution } from "./engine";
import { runAdapter } from "./adapters";

type Published = {
  id: string;
  workspace_id: string;
  graph: WorkflowGraph;
};

export async function tickPolling() {
  const rows = await query<Published>(
    `select a.id, a.workspace_id, v.graph
     from automations a
     join automation_versions v on v.id = a.published_version_id
     where a.status = 'on' and a.deleted_at is null`
  );
  let fired = 0;
  for (const auto of rows) {
    const trigger = auto.graph.nodes.find((n) => n.type === "trigger");
    if (!trigger) continue;
    const app = getApp(trigger.appSlug);
    const op = app?.operations.find((o) => o.key === trigger.operation);
    if (op?.triggerMode !== "polling") continue;

    const cursorRow = await queryOne<{ cursor: Record<string, unknown> }>(
      `select cursor from polling_cursors where automation_id=$1 and app_slug=$2 and operation=$3`,
      [auto.id, trigger.appSlug, trigger.operation]
    );
    const cursor = cursorRow?.cursor ?? {};

    try {
      const resolved = await loadCompatibleConnectionAuth(trigger.connectionId, auto.workspace_id, trigger.appSlug);
      if (!resolved.auth) {
        // Do not let one incomplete legacy flow prevent every other schedule or
        // polling trigger from running. Publishing now blocks this state.
        console.warn(`[poll] Skipped ${auto.id}: no connected account for ${trigger.appSlug}.`);
        continue;
      }
      const result = await runAdapter({
        appSlug: trigger.appSlug,
        operation: trigger.operation,
        input: { ...(trigger.config ?? {}), cursor },
        auth: resolved.auth,
        workspaceId: auto.workspace_id,
        executionId: "poll",
        connectionId: resolved.connectionId ?? undefined
      });
      const seen = String(cursor.lastId ?? "");
      const id = String(result.output.id ?? result.output.messageId ?? "");
      if (id && id !== seen) {
        if (seen) {
          await createExecution({
            automationId: auto.id,
            triggerType: "polling",
            triggerData: result.output,
            idempotencyKey: `poll:${auto.id}:${id}`
          });
          fired += 1;
        }
      }
      await query(
        `insert into polling_cursors (workspace_id, automation_id, app_slug, operation, cursor, last_polled_at)
         values ($1,$2,$3,$4,$5, now())
         on conflict (automation_id, app_slug, operation)
         do update set cursor=excluded.cursor, last_polled_at=now()`,
        [auto.workspace_id, auto.id, trigger.appSlug, trigger.operation, JSON.stringify({ lastId: id || seen, polledAt: new Date().toISOString() })]
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "poll_failed";
      console.warn(`[poll] ${auto.id} (${trigger.appSlug}.${trigger.operation}) failed: ${message}`);
    }
  }
  return fired;
}
