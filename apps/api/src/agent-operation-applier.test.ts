import test from "node:test";
import assert from "node:assert/strict";
import { applyAgentOperations } from "./agent-operation-applier";
import { normalizeWorkflowGraph } from "@algoverge/shared";

test("rejects unknown agent operations without mutating the graph", async () => {
  const result = await applyAgentOperations({
    graph: { nodes: [], edges: [] },
    operations: [{ kind: "unknown_operation", arguments: {} }],
    workspaceId: "workspace-test",
    organizationId: "org-test",
  });
  assert.equal(result.applied.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].operation.kind, "unknown_operation");
  assert.ok(result.graph.nodes.length >= 2);
});

test("requires confirmation for destructive operations", async () => {
  const result = await applyAgentOperations({
    graph: { nodes: [], edges: [] },
    operations: [{ kind: "remove_node", arguments: { nodeId: "missing" }, requires_confirmation: true }],
    workspaceId: "workspace-test",
    organizationId: "org-test",
  });
  assert.equal(result.applied.length, 0);
  assert.equal(result.needsConfirmation.length, 1);
  assert.equal(result.rejected.length, 0);
});

test("does not allow an unknown catalog operation to be created", async () => {
  const result = await applyAgentOperations({
    graph: { nodes: [], edges: [] },
    operations: [{ kind: "add_node", arguments: { appSlug: "definitely-not-an-app", operation: "run" } }],
    workspaceId: "workspace-test",
    organizationId: "org-test",
  });
  assert.equal(result.applied.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /Unknown app/);
});

test("approval boundary: confirmation-required ops are queued when allowDestructive=false", async () => {
  const graph = normalizeWorkflowGraph({
    nodes: [
      { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", label: "Manual", position: { x: 0, y: 0 }, config: {} },
      { id: "step1", type: "action", appSlug: "http", operation: "request", label: "HTTP", position: { x: 0, y: 160 }, config: {} },
    ],
    edges: [{ id: "e1", source: "trigger", target: "step1" }],
  });
  const result = await applyAgentOperations({
    graph,
    operations: [{ kind: "remove_node", arguments: { nodeId: "step1" } }],
    workspaceId: "workspace-test",
    organizationId: "org-test",
    allowDestructive: false,
  });
  assert.equal(result.applied.length, 0);
  assert.equal(result.needsConfirmation.length, 1);
  assert.equal(result.needsConfirmation[0].kind, "remove_node");
  assert.equal(result.graph.nodes.length, 2);
});

test("approval boundary: confirmation-required ops are applied when allowDestructive=true", async () => {
  const graph = normalizeWorkflowGraph({
    nodes: [
      { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", label: "Manual", position: { x: 0, y: 0 }, config: {} },
      { id: "step1", type: "action", appSlug: "http", operation: "request", label: "HTTP", position: { x: 0, y: 160 }, config: {} },
    ],
    edges: [{ id: "e1", source: "trigger", target: "step1" }],
  });
  const result = await applyAgentOperations({
    graph,
    operations: [{ kind: "remove_node", arguments: { nodeId: "step1" } }],
    workspaceId: "workspace-test",
    organizationId: "org-test",
    allowDestructive: true,
  });
  assert.equal(result.applied.length, 1);
  assert.equal(result.needsConfirmation.length, 0);
  assert.ok(!result.graph.nodes.some((n) => n.id === "step1"), "step1 should have been removed");
  assert.ok(!result.graph.edges.some((e) => e.source === "step1" || e.target === "step1"), "edges referencing step1 should be removed");
});

test("approval boundary: operations are validated against the current catalog", async () => {
  const graph = normalizeWorkflowGraph({
    nodes: [
      { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", label: "Manual", position: { x: 0, y: 0 }, config: {} },
      { id: "step1", type: "action", appSlug: "http", operation: "request", label: "HTTP", position: { x: 0, y: 160 }, config: {} },
    ],
    edges: [{ id: "e1", source: "trigger", target: "step1" }],
  });
  const result = await applyAgentOperations({
    graph,
    operations: [{ kind: "add_node", arguments: { appSlug: "nonexistent-app", operation: "do_thing" } }],
    workspaceId: "workspace-test",
    organizationId: "org-test",
    allowDestructive: true,
  });
  assert.equal(result.applied.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /Unknown app/);
});

test("supports add, update, connect and field mapping as one incremental operation sequence", async () => {
  const graph = normalizeWorkflowGraph({
    nodes: [
      { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", label: "Manual", position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [],
  });
  const result = await applyAgentOperations({
    graph,
    operations: [
      { kind: "add_node", arguments: { nodeId: "step1", appSlug: "http", operation: "request", label: "Send HTTP", config: {} } },
      { kind: "connect_nodes", arguments: { source: "trigger", target: "step1" } },
      { kind: "configure_node", arguments: { nodeId: "step1", config: { url: "https://example.com" } } },
      { kind: "map_field", arguments: { nodeId: "step1", field: "body", value: "{{trigger.email}}" } },
      { kind: "update_node", arguments: { nodeId: "step1", label: "Send lead" } },
      { kind: "validate_workflow", arguments: {} },
    ],
    workspaceId: "workspace-test",
    organizationId: "org-test",
    allowDestructive: true,
  });
  assert.equal(result.applied.length, 6);
  assert.equal(result.rejected.length, 0);
  const step = result.graph.nodes.find((node) => node.id === "step1");
  assert.equal(step?.label, "Send lead");
  assert.equal(step?.config?.url, "https://example.com");
  assert.equal(step?.config?.body, "{{trigger.email}}");
  assert.ok(result.graph.edges.some((edge) => edge.source === "trigger" && edge.target === "step1"));
});
