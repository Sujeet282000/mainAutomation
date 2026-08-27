import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflowGraph } from "./workflow-validation";

test("published workflows reject cycles and incomplete steps", async () => {
  const result = await validateWorkflowGraph(
    {
      nodes: [
        { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", config: {} },
        { id: "action", type: "action", appSlug: "", operation: "", config: {} }
      ],
      edges: [
        { id: "a", source: "trigger", target: "action" },
        { id: "b", source: "action", target: "trigger" }
      ]
    },
    { workspaceId: "00000000-0000-4000-8000-000000000000", strict: true }
  );
  assert.ok(result.issues.some((issue) => issue.code === "cycle"));
  assert.ok(result.issues.some((issue) => issue.code === "incomplete_step"));
});

test("draft workflows remain saveable while a step is incomplete", async () => {
  const result = await validateWorkflowGraph(
    {
      nodes: [
        { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", config: {} },
        { id: "action", type: "action", appSlug: "", operation: "", config: {} }
      ],
      edges: [{ id: "a", source: "trigger", target: "action" }]
    },
    { workspaceId: "00000000-0000-4000-8000-000000000000", strict: false }
  );
  assert.equal(result.issues.length, 0);
});

test("published workflows require configured operation inputs on the server", async () => {
  const result = await validateWorkflowGraph(
    {
      nodes: [
        { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", config: {} },
        { id: "action", type: "action", appSlug: "http", operation: "request", config: { method: "GET" } }
      ],
      edges: [{ id: "a", source: "trigger", target: "action" }]
    },
    { workspaceId: "00000000-0000-4000-8000-000000000000", strict: true }
  );
  assert.ok(result.issues.some((issue) => issue.code === "missing_required_field" && issue.nodeId === "action"));
});

test("workflow validation rejects credentials in node configuration", async () => {
  const result = await validateWorkflowGraph(
    {
      nodes: [
        { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", config: {} },
        { id: "action", type: "action", appSlug: "http", operation: "request", config: { apiKey: "secret" } }
      ],
      edges: [{ id: "a", source: "trigger", target: "action" }]
    },
    { workspaceId: "00000000-0000-4000-8000-000000000000", strict: false }
  );
  assert.ok(result.issues.some((issue) => issue.code === "credential_material" && issue.nodeId === "action"));
});

test("Google connections are reusable across Google pieces", async () => {
  const result = await validateWorkflowGraph(
    {
      nodes: [
        { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", config: {} },
        {
          id: "action",
          type: "action",
          appSlug: "google-calendar",
          operation: "create_event",
          connectionId: "00000000-0000-4000-8000-000000000000",
          config: { summary: "Standup", start: "2026-01-01T09:00:00Z", end: "2026-01-01T10:00:00Z" }
        }
      ],
      edges: [{ id: "a", source: "trigger", target: "action" }]
    },
    { workspaceId: "00000000-0000-4000-8000-000000000000", strict: true }
  );
  // The database lookup is empty in this unit test; it must not report a false
  // app-mismatch before it has established connection ownership.
  assert.ok(!result.issues.some((issue) => issue.code === "connection_app"));
});
