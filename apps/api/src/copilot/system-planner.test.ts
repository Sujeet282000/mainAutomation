import assert from "node:assert/strict";
import test from "node:test";
import { planSystem, planToGraph } from "./system-planner";

test("System planner creates lead management plan", () => {
  const plan = planSystem({
    prompt: "I want a system where website leads are collected, stored, qualified by AI, and hot leads are sent to sales",
  });
  assert.ok(plan.steps.length >= 3, `Should have at least 3 steps, got ${plan.steps.length}`);
  assert.ok(plan.products.length >= 2, `Should involve at least 2 products, got ${plan.products.length}`);
  assert.ok(plan.confidence > 0.3, "Should have reasonable confidence");
  assert.ok(plan.summary.length > 10, "Should have a meaningful summary");
});

test("System planner converts plan to graph", () => {
  const plan = planSystem({
    prompt: "Create a form that collects leads, stores them in Sheets, and sends Slack notification",
  });
  const catalog = [
    { slug: "forms", name: "Forms", operations: [{ key: "new_submission", name: "New Submission", type: "trigger" }] },
    { slug: "google-sheets", name: "Google Sheets", operations: [{ key: "append_row", name: "Append Row", type: "action" }] },
    { slug: "slack", name: "Slack", operations: [{ key: "send_message", name: "Send Message", type: "action" }] },
    { slug: "openai", name: "OpenAI", operations: [{ key: "summarize", name: "Summarize", type: "action" }] },
  ] as any;
  const graph = planToGraph(plan, catalog);
  assert.ok(graph.nodes.length >= 2, `Graph should have at least 2 nodes, got ${graph.nodes.length}`);
  assert.ok(graph.edges.length >= 1, `Graph should have at least 1 edge, got ${graph.edges.length}`);
});

test("System planner detects customer support pattern", () => {
  const plan = planSystem({
    prompt: "Build a customer support system that tracks tickets and classifies them with AI",
  });
  assert.ok(plan.steps.length >= 2, "Should have at least 2 steps");
  assert.ok(plan.summary.length > 10, "Should have a meaningful summary");
});

test("System planner identifies connections needed", () => {
  const plan = planSystem({
    prompt: "When a form is submitted, save to Google Sheets and notify via Slack",
  });
  assert.ok(plan.connections.length > 0, "Should identify connections needed");
});

test("System planner handles simple workflow requests", () => {
  const plan = planSystem({
    prompt: "When a new Gmail arrives, send a Slack message",
  });
  assert.ok(plan.steps.length >= 1, "Should have at least 1 step");
  assert.ok(plan.confidence > 0.3, "Should have reasonable confidence");
});

test("System planner marks cross-product systems", () => {
  const plan = planSystem({
    prompt: "Build a complete lead management system with form, table, AI, and notifications",
  });
  assert.ok(plan.isSystem, "Should be marked as a system");
});

test("System planner produces valid graph nodes with correct types", () => {
  const plan = planSystem({
    prompt: "Create a form to collect leads, store in table, qualify with AI, send Slack alert",
  });
  const catalog = [
    { slug: "forms", name: "Forms", operations: [{ key: "new_submission", name: "New Submission", type: "trigger" }] },
    { slug: "google-sheets", name: "Google Sheets", operations: [{ key: "append_row", name: "Append Row", type: "action" }] },
    { slug: "openai", name: "OpenAI", operations: [{ key: "score", name: "Score", type: "action" }] },
    { slug: "slack", name: "Slack", operations: [{ key: "send_message", name: "Send Message", type: "action" }] },
  ] as any;
  const graph = planToGraph(plan, catalog);
  // First node should be a trigger
  const firstNode = graph.nodes[0];
  assert.ok(firstNode, "Should have at least one node");
  assert.equal(firstNode.type, "trigger", "First node should be a trigger");
});
