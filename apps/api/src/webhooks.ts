import type { Request, Response } from "express";
import { getApp } from "./catalog/catalog";
import { query, queryOne } from "./db";
import { createExecution } from "./engine";
import { hmacSha256Hex, timingSafeEqualHex } from "./webhook-crypto";
import { normalizeWorkflowGraph, type WorkflowGraph } from "@algoverge/shared";

export { catchHookUrl, hmacSha256Hex, timingSafeEqualHex, verifyMetaSignature, verifyStripeSignature } from "./webhook-crypto";

function headerSecret(req: Request) {
  return String(req.get("x-webhook-signature") ?? req.get("x-hub-signature-256") ?? req.get("x-signature") ?? "");
}

export async function handleCatchHook(req: Request, res: Response) {
  const publicId = String(req.params.publicId ?? "");
  const auto = await queryOne<{ id: string; workspace_id: string }>(
    `select id, workspace_id from automations
     where webhook_public_id=$1 and status in ('on','paused') and deleted_at is null`,
    [publicId]
  );
  if (!auto) return res.status(404).json({ error: "unknown_webhook" });
  const live = await queryOne<{ status: string }>(`select status from automations where id=$1`, [auto.id]);
  if (live?.status === "paused") return res.status(409).json({ error: "automation_paused" });
  if (live?.status !== "on") return res.status(404).json({ error: "unknown_webhook" });

  const version = await queryOne<{ graph: WorkflowGraph }>(
    `select v.graph from automations a
     join automation_versions v on v.id = coalesce(a.published_version_id, a.current_version_id)
     where a.id=$1`,
    [auto.id]
  );
  const graph = normalizeWorkflowGraph(version?.graph);
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  const secret = String(trigger?.config?.secret ?? trigger?.config?.hmacSecret ?? "");
  if (secret) {
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    const provided = headerSecret(req);
    if (!provided || !timingSafeEqualHex(hmacSha256Hex(secret, raw), provided.replace(/^sha256=/i, ""))) {
      return res.status(401).json({ error: "invalid_signature" });
    }
  }

  const app = trigger ? getApp(trigger.appSlug) : getApp("webhook");
  const op = app?.operations.find((o) => o.key === trigger?.operation);
  if (op?.triggerMode && op.triggerMode !== "webhook" && trigger?.appSlug !== "webhook") {
    return res.status(400).json({ error: "not_a_webhook_trigger" });
  }

  await query(
    `insert into webhook_events (workspace_id, public_id, headers, payload, processing_status)
     values ($1,$2,$3,$4,'queued')`,
    [auto.workspace_id, publicId, JSON.stringify(req.headers), JSON.stringify(req.body ?? {})]
  );
  const exec = await createExecution({
    automationId: auto.id,
    triggerType: "webhook",
    triggerData: { body: req.body, headers: req.headers, query: req.query },
    idempotencyKey: req.get("idempotency-key") ?? undefined
  });
  res.json({ ok: true, executionId: exec.id });
}
