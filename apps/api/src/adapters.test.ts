import assert from "node:assert/strict";
import test from "node:test";
import { listRegisteredAdapters } from "./adapters";
import { assertPublicUrl } from "./adapters/http";
import { pieceRegistry } from "./pieces/registry";

test("priority adapters are registered by slug+operation, not if-app switches", () => {
  const keys = listRegisteredAdapters();
  for (const k of [
    "whatsapp:send_message",
    "google-calendar:create_event",
    "google-sheets:create_row",
    "google-sheets:find_row",
    "stripe:create_customer",
    "openai:complete",
    "ai:summarize",
    "ai:classify",
    "filter:only_continue_if",
    "paths:branch",
    "paths:router",
    "loop:for_each",
    "delay:for",
    "delay:until"
  ]) {
    assert.ok(keys.includes(k), `missing ${k}`);
  }
});

test("HTTP client blocks private URLs", () => {
  assert.throws(() => assertPublicUrl("http://127.0.0.1/secret"));
  assert.throws(() => assertPublicUrl("http://169.254.169.254/latest"));
  assert.equal(assertPublicUrl("https://example.com/hook").hostname, "example.com");
});

test("piece registry exposes catalog operations", () => {
  const slack = pieceRegistry.getAction("slack", "send_message");
  assert.equal(slack.sideEffect, "create");
  assert.ok(pieceRegistry.cards().some((c) => c.piece === "gmail" && c.kind === "trigger"));
});
