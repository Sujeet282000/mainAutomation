import { env } from "./config";
import { createExecution, findPublishedByTrigger } from "./engine";
import { query } from "./db";

export async function handleStripeEvent(event: { type?: string; id?: string; data?: { object?: Record<string, unknown> } }) {
  const automations = await findPublishedByTrigger("stripe", "new_payment");
  for (const auto of automations) {
    await createExecution({
      automationId: auto.id,
      triggerType: "webhook",
      triggerData: { type: event.type, id: event.id, object: event.data?.object ?? {} },
      idempotencyKey: event.id ? `stripe:${event.id}:${auto.id}` : undefined
    });
  }
  return automations.length;
}

export async function handleWhatsAppPayload(body: Record<string, unknown>) {
  const entries = (body.entry as Array<{ changes?: Array<{ value?: { messages?: unknown[] } }> }>) ?? [];
  const messages: unknown[] = [];
  for (const e of entries) {
    for (const c of e.changes ?? []) {
      messages.push(...(c.value?.messages ?? []));
    }
  }
  if (messages.length === 0) return 0;
  const automations = await findPublishedByTrigger("whatsapp", "inbound_message");
  for (const auto of automations) {
    await createExecution({
      automationId: auto.id,
      triggerType: "webhook",
      triggerData: { messages, raw: body }
    });
  }
  return automations.length;
}

export function whatsappVerify(mode: string, token: string, challenge: string) {
  if (mode === "subscribe" && token === env.meta.verifyToken) return challenge;
  return null;
}

export async function recordWebhook(workspaceId: string | null, appSlug: string, payload: unknown) {
  if (!workspaceId) return;
  await query(
    `insert into webhook_events (workspace_id, app_slug, payload, processing_status) values ($1,$2,$3,'queued')`,
    [workspaceId, appSlug, JSON.stringify(payload)]
  );
}
