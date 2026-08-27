import { taskUnitsForStep } from "./metering";
import assert from "node:assert/strict";
import test from "node:test";

test("built-in tools and tables are free", () => {
  assert.equal(taskUnitsForStep({ appSlug: "filter", isTrigger: false, byok: false }), 0);
  assert.equal(taskUnitsForStep({ appSlug: "tables", isTrigger: false, byok: false }), 0);
  assert.equal(taskUnitsForStep({ appSlug: "webhook", isTrigger: true, byok: false }), 0);
  assert.equal(taskUnitsForStep({ appSlug: "ai-guardrails", isTrigger: false, byok: false }), 0);
});

test("actions bill 1 task, AI tiers multiply, MCP doubles", () => {
  assert.equal(taskUnitsForStep({ appSlug: "slack", isTrigger: false, byok: false }), 1);
  assert.equal(taskUnitsForStep({ appSlug: "openai", isTrigger: false, byok: false, aiTier: "advanced" }), 3);
  assert.equal(taskUnitsForStep({ appSlug: "openai", isTrigger: false, byok: true, aiTier: "premium" }), 1);
  assert.equal(taskUnitsForStep({ appSlug: "ai", isTrigger: false, byok: false, aiTier: "standard" }), 1);
  assert.equal(taskUnitsForStep({ appSlug: "slack", isTrigger: false, byok: false, mcp: true }), 2);
});
