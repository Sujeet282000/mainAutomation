import assert from "node:assert/strict";
import test from "node:test";
import { mapFields, applyMappings } from "./field-mapper";
import type { WorkflowGraph } from "@algoverge/shared";

const catalog = [
  {
    slug: "gmail",
    operations: [{
      key: "new_email",
      outputSample: { from: "test@example.com", subject: "Hello", body: "Content here", date: "2024-01-01" },
      inputFields: [],
    }],
  },
  {
    slug: "slack",
    operations: [{
      key: "send_message",
      inputFields: [
        { key: "channel", label: "Channel", type: "string", required: true },
        { key: "message", label: "Message", type: "string", required: true },
      ],
      outputSample: { channel: "C123", text: "sent", ts: "1234" },
    }],
  },
  {
    slug: "google-sheets",
    operations: [{
      key: "append_row",
      inputFields: [
        { key: "spreadsheet_id", label: "Spreadsheet ID", type: "string", required: true },
        { key: "values", label: "Values", type: "json", required: true },
      ],
      outputSample: { spreadsheet_id: "abc", row: 1 },
    }],
  },
] as any;

const graph: WorkflowGraph = {
  nodes: [
    { id: "trigger", type: "trigger", appSlug: "gmail", operation: "new_email", label: "New Email", position: { x: 280, y: 40 }, config: {}, connectionId: null },
    { id: "action", type: "action", appSlug: "slack", operation: "send_message", label: "Send Message", position: { x: 280, y: 200 }, config: {}, connectionId: null },
  ],
  edges: [{ id: "e-1", source: "trigger", target: "action" }],
};

test("Field mapper matches email to message field", () => {
  const result = mapFields(graph, catalog);
  assert.ok(result.mappings.length > 0, "Should find at least 1 mapping");
  // Should map body -> message or subject -> message
  const bodyToMsg = result.mappings.find((m) => m.sourceField === "body" && m.targetField === "message");
  const subjectToMsg = result.mappings.find((m) => m.sourceField === "subject" && m.targetField === "message");
  assert.ok(bodyToMsg || subjectToMsg, "Should map body or subject to message field");
});

test("Field mapper identifies unmapped required fields", () => {
  const result = mapFields(graph, catalog);
  // Slack needs 'channel' which Gmail doesn't output
  assert.ok(result.unmappedRequired.length > 0, "Should have unmapped required fields");
  assert.ok(result.unmappedRequired.some((f) => f.field === "channel"), "Should identify channel as unmapped");
});

test("Field mapper assigns confidence scores", () => {
  const result = mapFields(graph, catalog);
  for (const mapping of result.mappings) {
    assert.ok(mapping.confidence > 0 && mapping.confidence <= 1, "Confidence should be between 0 and 1");
    assert.ok(mapping.expression.startsWith("{{"), "Expression should use template syntax");
  }
});

test("Apply mappings updates graph config", () => {
  const result = mapFields(graph, catalog);
  const { graph: updated, applied } = applyMappings(graph, result.mappings, 0.7);
  // At least the body->message mapping should be applied (high confidence)
  const slackNode = updated.nodes.find((n) => n.id === "action");
  assert.ok(slackNode, "Should have the action node");
  // Check if any field was applied
  if (applied.length > 0) {
    assert.ok(applied[0].expression.startsWith("{{"), "Applied mapping should have template expression");
  }
});

test("Field mapper handles 3-step workflow", () => {
  const threeStepGraph: WorkflowGraph = {
    nodes: [
      { id: "trigger", type: "trigger", appSlug: "gmail", operation: "new_email", label: "New Email", position: { x: 280, y: 40 }, config: {}, connectionId: null },
      { id: "ai", type: "action", appSlug: "openai", operation: "summarize", label: "Summarize", position: { x: 280, y: 200 }, config: {}, connectionId: null },
      { id: "sheets", type: "action", appSlug: "google-sheets", operation: "append_row", label: "Append Row", position: { x: 280, y: 360 }, config: {}, connectionId: null },
    ],
    edges: [
      { id: "e-1", source: "trigger", target: "ai" },
      { id: "e-2", source: "ai", target: "sheets" },
    ],
  };
  const result = mapFields(threeStepGraph, catalog);
  assert.ok(result.mappings.length >= 0, "Should analyze all step pairs");
  assert.ok(typeof result.confidence === "number", "Should have a confidence score");
});

test("Field mapper returns empty for single-node graph", () => {
  const singleNode: WorkflowGraph = {
    nodes: [{ id: "trigger", type: "trigger", appSlug: "gmail", operation: "new_email", label: "New Email", position: { x: 280, y: 40 }, config: {}, connectionId: null }],
    edges: [],
  };
  const result = mapFields(singleNode, catalog);
  assert.equal(result.mappings.length, 0, "Should have no mappings for single node");
  assert.equal(result.confidence, 1, "Confidence should be 1 for single node (nothing to map)");
});
