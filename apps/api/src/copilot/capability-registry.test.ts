import assert from "node:assert/strict";
import test from "node:test";
import { matchProducts, matchCapabilities, isCrossProductSystem, getEntryPoint, describeProductPlan } from "./capability-registry";

test("Capability registry detects form intent", () => {
  const products = matchProducts("When a form is submitted, save to Sheets");
  assert.ok(products.length > 0);
  assert.ok(products.some((p) => p.product === "form"), "Should detect form product");
  assert.ok(products.some((p) => p.product === "table"), "Should detect table (Sheets)");
});

test("Capability registry detects lead management system", () => {
  const products = matchProducts("Build a lead management system with form, AI qualification, and Slack notification");
  assert.ok(products.length >= 3, `Should detect at least 3 products, got ${products.length}`);
  const types = products.map((p) => p.product);
  assert.ok(types.includes("form") || types.includes("automation"), "Should detect form or automation");
  assert.ok(types.includes("agent") || types.includes("automation"), "Should detect agent or automation for AI");
  assert.ok(types.includes("notification"), "Should detect notification for Slack");
});

test("Capability registry matches AI capabilities", () => {
  const caps = matchCapabilities("Summarize the email with AI and classify the lead");
  assert.ok(caps.length > 0, "Should match AI capabilities");
  assert.ok(caps.some((c) => c.product === "agent"), "Should detect agent product");
});

test("Cross-product system detection", () => {
  // Multi-product system requests should be detected
  assert.equal(isCrossProductSystem("Build a complete lead management system with forms, tables, AI, and notifications"), true);
  assert.equal(isCrossProductSystem("Create a customer onboarding system that collects data, stores it, and processes with AI"), true);
  // Simple single-action requests should not be cross-product systems
  assert.equal(isCrossProductSystem("Create a form"), false);
  assert.equal(isCrossProductSystem("Send a Slack message"), false);
});

test("Entry point selection", () => {
  assert.equal(getEntryPoint(["form", "table", "automation"]), "form");
  assert.equal(getEntryPoint(["automation", "table"]), "automation");
  assert.equal(getEntryPoint(["chatbot", "agent"]), "chatbot");
});

test("Product plan description", () => {
  const desc = describeProductPlan(
    ["form", "table", "agent"],
    [{ product: "form", capability: "create_form" }, { product: "table", capability: "create_table" }]
  );
  assert.ok(desc.includes("Forms"), "Should include Forms");
  assert.ok(desc.includes("Tables"), "Should include Tables");
  assert.ok(desc.includes("create_form"), "Should include capability names");
});

test("Email notification capability detection", () => {
  const caps = matchCapabilities("Send an email notification when the form is submitted");
  assert.ok(caps.some((c) => c.capability.id === "send_email"), "Should detect send_email capability");
});

test("Slack notification capability detection", () => {
  const caps = matchCapabilities("Post to Slack when the lead is qualified");
  assert.ok(caps.some((c) => c.capability.id === "send_slack"), "Should detect send_slack capability");
});
