import { strict as assert } from "node:assert";
import test from "node:test";
import { applyAgentOperations, AgentOperationError } from "./applier";

const graph = { nodes: [], edges: [] };

test("adds a real catalog operation without mutating the input graph", () => {
  const result = applyAgentOperations(graph, [{ kind: "add_node", arguments: { nodeId: "trigger-1", appSlug: "manual", operation: "manual_trigger", label: "Manual" } }]);
  assert.equal(result.nodes.length, 1);
  assert.equal(graph.nodes.length, 0);
});

test("rejects unknown catalog operations", () => {
  assert.throws(() => applyAgentOperations(graph, [{ kind: "add_node", arguments: { nodeId: "x", appSlug: "missing", operation: "nope" } }]), AgentOperationError);
});

test("prevents a second trigger", () => {
  const initial = applyAgentOperations(graph, [{ kind: "add_node", arguments: { nodeId: "t1", appSlug: "manual", operation: "manual_trigger", label: "Manual" } }]);
  assert.throws(() => applyAgentOperations(initial, [{ kind: "add_node", arguments: { nodeId: "t2", appSlug: "manual", operation: "manual_trigger", label: "Manual 2" } }]), AgentOperationError);
});

test("connects existing nodes", () => {
  const initial = applyAgentOperations(graph, [
    { kind: "add_node", arguments: { nodeId: "t", appSlug: "manual", operation: "manual_trigger", label: "Trigger" } },
    { kind: "add_node", arguments: { nodeId: "a", appSlug: "manual", operation: "manual_trigger", label: "Action" } },
  ]);
  const result = applyAgentOperations(initial, [{ kind: "connect_nodes", arguments: { source: "t", target: "a" } }]);
  assert.equal(result.edges.length, 1);
});
