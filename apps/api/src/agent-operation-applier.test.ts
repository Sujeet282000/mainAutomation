import test from "node:test";
import assert from "node:assert/strict";
import { applyAgentOperations } from "./agent-operation-applier";

test("rejects unknown agent operations without mutating the graph", async () => {
  const result = await applyAgentOperations({
    graph: { nodes: [], edges: [] },
    operations: [{ kind: "unknown_operation", arguments: {} }],
    workspaceId: "workspace-test",
    organizationId: "org-test",
  });
  assert.equal(result.applied.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.graph.nodes.length, 0);
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
  assert.equal(result.graph.nodes.length, 0);
});
