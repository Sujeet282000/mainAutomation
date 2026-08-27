import test from "node:test";
import assert from "node:assert/strict";
import { applyAgentOperations, AgentOperationError } from "./agent/applier";
import type { WorkflowGraph } from "@algoverge/shared";

const base: WorkflowGraph = {
  nodes: [{ id: "trigger", type: "trigger", appSlug: "webhook", operation: "catch_hook", label: "Webhook", position: { x: 0, y: 0 }, config: {} }],
  edges: []
};

test("applies add/connect/configure operations without mutating the source graph", () => {
  const result = applyAgentOperations(base, [
    { type: "ADD_NODE", node: { id: "slack-send", type: "action", appSlug: "slack", operation: "send_message", label: "Send Slack message", position: { x: 0, y: 160 }, config: {} } },
    { type: "CONNECT_NODES", source: "trigger", target: "slack-send" },
    { type: "MAP_FIELD", nodeId: "slack-send", field: "text", value: "{{trigger.body}}" }
  ]);

  assert.equal(base.nodes.length, 1);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 1);
  assert.equal(result.nodes[1].config.text, "{{trigger.body}}");
});

test("rejects invalid operations and a second trigger", () => {
  assert.throws(
    () => applyAgentOperations(base, [{ type: "ADD_NODE", node: { id: "t2", type: "trigger", appSlug: "webhook", operation: "catch_hook", label: "Second", position: { x: 0, y: 0 }, config: {} } }]),
    AgentOperationError
  );
  assert.throws(() => applyAgentOperations(base, [{ type: "MAP_FIELD", nodeId: "missing", field: "x", value: "y" }]), AgentOperationError);
});
