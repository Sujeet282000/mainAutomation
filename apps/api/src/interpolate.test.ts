import assert from "node:assert/strict";
import test from "node:test";
import { interpolate } from "@algoverge/shared";

test("interpolates Trigger aliases and does not glue unresolved tokens", () => {
  const ctx = { trigger: { id: "evt1", summary: "Standup", start: "2026-01-01T09:00:00Z" }, steps: {} };
  assert.equal(interpolate("{{Trigger.summary}}", ctx), "Standup");
  assert.equal(interpolate("{{trigger.id}}", ctx), "evt1");
  assert.equal(interpolate("user@example.com{{Trigger.missing}}", ctx), "user@example.com");
});

test("resolves step outputs by id", () => {
  const ctx = { trigger: {}, steps: { a: { to: "ada@example.com" } } };
  assert.equal(interpolate("{{steps.a.to}}", ctx), "ada@example.com");
  assert.equal(interpolate("{{a.to}}", ctx), "ada@example.com");
});

test("supports pipe filters on interpolated strings", () => {
  const ctx = { trigger: { name: "Ada" }, steps: {} };
  assert.equal(interpolate("{{trigger.name | upper}}", ctx), "ADA");
});
