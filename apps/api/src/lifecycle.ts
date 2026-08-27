import { getApp } from "./catalog";
import { query } from "./db";
import { catchHookUrl } from "./webhook-crypto";
import { normalizeWorkflowGraph, type WorkflowGraph } from "@algoverge/shared";

/**
 * Doc 3 §12.5 / Doc 4 §3.6: on publish, register the trigger subscription.
 * Catch-hook automations bind a unique public URL. Vendor subscribe() is only
 * called when a Piece defines it — most inbound apps use the platform URL.
 */
export async function subscribeTrigger(opts: {
  automationId: string;
  workspaceId: string;
  publicId: string;
  graph: WorkflowGraph;
  enabled: boolean;
}) {
  const graph = normalizeWorkflowGraph(opts.graph);
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  const app = trigger ? getApp(trigger.appSlug) : null;
  const op = app?.operations.find((o) => o.key === trigger?.operation);
  const url = catchHookUrl(opts.publicId);

  if (!opts.enabled) {
    await query(
      `update webhook_subscriptions set status='inactive' where automation_id=$1`,
      [opts.automationId]
    );
    return { url, subscribed: false };
  }

  await query(
    `insert into webhook_subscriptions (workspace_id, automation_id, app_slug, public_id, status, metadata)
     values ($1,$2,$3,$4,'active',$5)
     on conflict (public_id) do update set
       automation_id=excluded.automation_id,
       app_slug=excluded.app_slug,
       status='active',
       metadata=excluded.metadata`,
    [
      opts.workspaceId,
      opts.automationId,
      trigger?.appSlug ?? "webhook",
      opts.publicId,
      JSON.stringify({
        url,
        triggerMode: op?.triggerMode ?? "webhook",
        operation: trigger?.operation ?? null
      })
    ]
  );
  return { url, subscribed: true };
}
