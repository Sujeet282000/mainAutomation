import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWorkflowGraph } from "@algoverge/shared";

test("normalizeWorkflowGraph maps React Flow step types back to trigger/action", () => {
  const g = normalizeWorkflowGraph({
    nodes: [
      { id: "a", type: "step", data: { kind: "trigger", label: "Gmail", appSlug: "gmail", operation: "new_email" }, position: { x: 10, y: 10 } },
      { id: "b", type: "step", data: { kind: "action", label: "Slack", appSlug: "slack", operation: "send_message" }, position: { x: 10, y: 180 } }
    ],
    edges: [{ id: "e1", source: "a", target: "b" }]
  });
  assert.equal(g.nodes[0].type, "trigger");
  assert.equal(g.nodes[1].type, "action");
  assert.equal(g.nodes[0].appSlug, "gmail");
  assert.equal(g.nodes[1].operation, "send_message");
});

test("normalizeWorkflowGraph reads canvas-style kind/x/y nodes", () => {
  const g = normalizeWorkflowGraph({
    nodes: [
      { id: "t", kind: "trigger", label: "Webhook", appSlug: "webhook", operation: "catch", x: 10, y: 20 },
      { id: "a", kind: "action", label: "Slack", appSlug: "slack", operation: "send_message", x: 10, y: 180 }
    ],
    edges: [{ id: "e1", source: "t", target: "a" }]
  });
  assert.equal(g.nodes[0].type, "trigger");
  assert.equal(g.nodes[1].type, "action");
  assert.equal(g.nodes[0].position.x, 10);
  assert.equal(g.nodes[0].position.y, 20);
});

test("normalizeWorkflowGraph always includes a trigger and an action placeholder", () => {
  const g = normalizeWorkflowGraph({ nodes: [], edges: [] });
  assert.ok(g.nodes.some((n) => n.type === "trigger"));
  assert.ok(g.nodes.some((n) => n.type !== "trigger"));
});
