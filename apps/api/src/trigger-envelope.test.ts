import assert from "node:assert/strict";
import test from "node:test";
import { buildTriggerEnvelope } from "./trigger-envelope";

test("buildTriggerEnvelope derives a stable key from a provider event", () => {
  const envelope = buildTriggerEnvelope({
    workspaceId: "workspace",
    organizationId: "org",
    automationId: "automation",
    triggerType: "webhook",
    eventId: "delivery-1",
    payload: { value: 1 },
  });
  assert.equal(envelope.idempotencyKey, "webhook:automation:delivery-1");
  assert.equal(envelope.eventId, "delivery-1");
  assert.deepEqual(envelope.payload, { value: 1 });
});

test("buildTriggerEnvelope preserves explicit idempotency keys", () => {
  const envelope = buildTriggerEnvelope({
    workspaceId: "workspace",
    organizationId: "org",
    automationId: "automation",
    triggerType: "schedule",
    idempotencyKey: "schedule:automation:tick-1",
  });
  assert.equal(envelope.idempotencyKey, "schedule:automation:tick-1");
});