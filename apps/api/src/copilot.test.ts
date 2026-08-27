import assert from "node:assert/strict";
import test from "node:test";
import { copilotChat, explainLastTest, isCatalogGraph, refineGraph } from "./copilot";
import { copilotShouldPersist, parseCopilotMode } from "./copilot-pipeline";
import { diagnoseFromFailure } from "./diagnose";
import { deterministicWorkflowAdvice } from "./workflow-advisor";

test("Copilot accepts a catalog-valid trigger and action graph", () => {
  assert.equal(
    isCatalogGraph({
      nodes: [
        { id: "trigger", type: "trigger", appSlug: "gmail", operation: "new_email", label: "New Email", position: { x: 0, y: 0 }, config: {} },
        { id: "action", type: "action", appSlug: "slack", operation: "send_message", label: "Send Channel Message", position: { x: 0, y: 160 }, config: {} }
      ],
      edges: [{ id: "e1", source: "trigger", target: "action" }]
    }),
    true
  );
});

test("Copilot rejects credential material in generated graph config", () => {
  assert.equal(
    isCatalogGraph({
      nodes: [
        { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", label: "Manual", position: { x: 0, y: 0 }, config: {} },
        { id: "action", type: "action", appSlug: "http", operation: "request", label: "HTTP", position: { x: 0, y: 160 }, config: { apiKey: "should-not-be-here" } }
      ],
      edges: [{ id: "e1", source: "trigger", target: "action" }]
    }),
    false
  );
});

test("Copilot rejects hallucinated operations and invalid trigger semantics", () => {
  assert.equal(
    isCatalogGraph({
      nodes: [
        { id: "trigger", type: "trigger", appSlug: "gmail", operation: "invented_event", label: "Bad", position: { x: 0, y: 0 }, config: {} },
        { id: "action", type: "action", appSlug: "slack", operation: "new_message", label: "Bad action", position: { x: 0, y: 160 }, config: {} }
      ],
      edges: [{ id: "e1", source: "trigger", target: "action" }]
    })
  , false);
});

test("Copilot repairs missing operations and required config fields", async () => {
  const result = await copilotChat({
    prompt: "Fix incomplete steps",
    graph: {
      nodes: [
        { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", label: "Manual trigger", position: { x: 0, y: 0 }, config: {} },
        { id: "action", type: "action", appSlug: "http", operation: "request", label: "HTTP Request", position: { x: 0, y: 160 }, config: {} }
      ],
      edges: [{ id: "e1", source: "trigger", target: "action" }]
    }
  });

  assert.equal(result.source, "copilot-orchestrator");
  assert.equal(result.graph?.nodes.find((node) => node.id === "action")?.config.url, "https://httpbin.org/post");
});

test("Copilot chat changes a manual trigger to Google Sheets in place", async () => {
  const result = await copilotChat({
    prompt: "in manual trigger use google sheet",
    graph: {
      nodes: [
        { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", label: "Manual trigger", position: { x: 0, y: 0 }, config: {} },
        { id: "action", type: "action", appSlug: "http", operation: "request", label: "HTTP Request", position: { x: 0, y: 160 }, config: {} }
      ],
      edges: [{ id: "e1", source: "trigger", target: "action" }]
    }
  });
  const trigger = result.graph?.nodes.find((node) => node.type === "trigger");
  assert.equal(trigger?.appSlug, "google-sheets");
  assert.equal(trigger?.operation, "new_row");
  assert.match(result.reply, /Updated the draft|Google Sheets|New Row|in place|Updated step 1/i);
});

test("Copilot refine keeps HTTP when only the trigger app is changed", () => {
  const refined = refineGraph("in manual trigger use google sheet", {
    nodes: [
      { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", label: "Manual trigger", position: { x: 0, y: 0 }, config: {} },
      { id: "action", type: "action", appSlug: "http", operation: "request", label: "HTTP Request", position: { x: 0, y: 160 }, config: {} }
    ],
    edges: [{ id: "e1", source: "trigger", target: "action" }]
  });
  assert.equal(refined.changed, true);
  assert.equal(refined.rebuilt, false);
  assert.equal(refined.graph.nodes.find((node) => node.type === "trigger")?.appSlug, "google-sheets");
  assert.equal(refined.graph.nodes.find((node) => node.id === "action")?.appSlug, "http");
});

test("Copilot explains a provided last test result", async () => {
  const result = await copilotChat({
    prompt: "Explain the last test",
    lastTest: { ok: true, ms: 42, body: { id: "row_1", email: "ada@example.com" } }
  });
  assert.equal(result.graph, undefined);
  assert.match(result.reply, /succeeded/i);
  assert.match(result.reply, /42ms/);
});

test("Copilot chat adds Google Sheets without replacing the HTTP action", async () => {
  const result = await copilotChat({
    prompt: "add google sheet",
    graph: {
      nodes: [
        { id: "trigger", type: "trigger", appSlug: "webhook", operation: "catch", label: "Catch Hook", position: { x: 0, y: 0 }, config: {} },
        { id: "action", type: "action", appSlug: "http", operation: "request", label: "HTTP Request", position: { x: 0, y: 160 }, config: { url: "https://httpbin.org/post" } }
      ],
      edges: [{ id: "e1", source: "trigger", target: "action" }]
    }
  });
  assert.equal(result.graph?.nodes.find((node) => node.id === "action")?.appSlug, "http");
  assert.equal(result.graph?.nodes.some((node) => node.appSlug === "google-sheets"), true);
});

test("Ask as you build does not auto-apply Copilot draft persistence", () => {
  assert.equal(parseCopilotMode("ask_as_you_build"), "ask_as_you_build");
  assert.equal(copilotShouldPersist("ask_as_you_build"), false);
  assert.equal(copilotShouldPersist("auto_build"), true);
});

test("Copilot refuses to treat publish as its own action", async () => {
  const result = await copilotChat({ prompt: "publish this workflow now" });
  assert.match(result.reply, /cannot publish/i);
  assert.equal(result.graph, undefined);
});

test("Copilot chat can ask without rebuilding a catalog graph", async () => {
  const result = await copilotChat({
    prompt: "What fields are still empty on this canvas?",
    graph: {
      nodes: [
        { id: "trigger", type: "trigger", appSlug: "gmail", operation: "new_email", label: "New Email", position: { x: 0, y: 0 }, config: {} },
        { id: "action", type: "action", appSlug: "slack", operation: "send_message", label: "Send", position: { x: 0, y: 160 }, config: {} }
      ],
      edges: [{ id: "e1", source: "trigger", target: "action" }]
    }
  });
  assert.equal(result.graph, undefined);
  assert.match(result.reply, /step|publish|connect|map/i);
});

test("Ops copilot diagnoses auth failures as human reconnect work", () => {
  const d = diagnoseFromFailure({
    failed: { name: "Send Channel Message", error: { message: "401 unauthorized token expired" } }
  });
  assert.equal(d.category, "auth");
  assert.equal(d.safeToAutoApply, false);
  assert.equal(d.patch.length, 0);
});

test("Ops copilot identifies a disabled Gmail API precisely", () => {
  const d = diagnoseFromFailure({
    failed: { name: "New Email", error: { message: "Gmail poll failed (403): Gmail API has not been used in project 123 before or it is disabled. SERVICE_DISABLED" } }
  });
  assert.equal(d.category, "configuration");
  assert.match(d.userFix, /enable Gmail API/i);
});

test("workflow advisor gives the Gmail API activation fix from a failed test", () => {
  const reply = deterministicWorkflowAdvice({
    lastTest: { ok: false, body: { error: "Gmail API has not been used in project 123 before or it is disabled. SERVICE_DISABLED" } }
  });
  assert.match(reply, /enable Gmail API/i);
});

test("explain last test does not dump a Slack token as OpenAI key JSON", () => {
  const reply = explainLastTest({
    ok: false,
    ms: 751,
    body: { error: 'OpenAI failed (401): {"error":{"message":"Incorrect API key provided: xoxe.xox****"}}' }
  });
  assert.match(reply, /sk-/);
  assert.match(reply, /Slack token/i);
  assert.doesNotMatch(reply, /Incorrect API key provided/);
});
