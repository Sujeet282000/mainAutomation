import { createHash } from "node:crypto";

export type TriggerEnvelope = {
  eventId: string | null;
  workspaceId: string;
  organizationId: string;
  automationId: string;
  versionId: string | null;
  triggerType: string;
  receivedAt: string;
  idempotencyKey: string | null;
  payload: Record<string, unknown>;
};

export function buildTriggerEnvelope(input: {
  workspaceId: string;
  organizationId: string;
  automationId: string;
  versionId?: string | null;
  triggerType: string;
  payload?: Record<string, unknown>;
  eventId?: string | null;
  idempotencyKey?: string | null;
  receivedAt?: string;
}): TriggerEnvelope {
  const payload = input.payload ?? {};
  const eventId = input.eventId ?? (typeof payload.id === "string" ? payload.id : null);
  const idempotencyKey = input.idempotencyKey ?? (eventId
    ? `${input.triggerType}:${input.automationId}:${eventId}`
    : null);
  return {
    eventId,
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
    automationId: input.automationId,
    versionId: input.versionId ?? null,
    triggerType: input.triggerType,
    receivedAt: input.receivedAt ?? new Date().toISOString(),
    idempotencyKey,
    payload,
  };
}

export function deterministicTriggerKey(parts: string[]) {
  return createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
}
