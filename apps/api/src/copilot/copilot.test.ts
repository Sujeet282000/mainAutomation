import assert from "node:assert/strict";
import test from "node:test";
import { copilotChat, explainLastTest, isCatalogGraph, refineGraph } from "./copilot";
import { copilotShouldPersist, parseCopilotMode } from "./copilot-pipeline";
import { diagnoseFromFailure } from "../diagnose";
import { deterministicWorkflowAdvice } from "../workflow-advisor";

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

// ── Lead automation test scenario: Form → AI → Condition → Sheets → Notification ──

test("Copilot builds a lead automation from a form-to-sheets-and-slack prompt", async () => {
  // The copilot's heuristic engine maps apps by keyword matching.
  // A prompt mentioning "form", "sheets", "slack" should build a graph
  // containing at least those apps (or their heuristic equivalents).
  const result = await copilotChat({
    prompt: "When a form is submitted, save to Google Sheets and notify Slack",
    mode: "auto_build",
  });

  assert.ok(result.reply, "Copilot should reply");
  assert.ok(result.source, "Copilot should indicate source");
  
  const graph = result.graph;
  assert.ok(graph, "Copilot should return a graph");
  assert.ok(graph!.nodes.length >= 2, `Graph should have at least 2 nodes, got ${graph!.nodes.length}`);
  
  // Should have at least one trigger node
  const trigger = graph!.nodes.find((n) => n.type === "trigger");
  assert.ok(trigger, "Should have a trigger node");
  
  // Verify edges connect the steps
  assert.ok(graph!.edges.length >= 1, `Should have at least 1 edge, got ${graph!.edges.length}`);
  
  // Should have suggestions or next-step guidance
  assert.ok(result.suggestions?.length || result.youDoFirst?.length, "Should have suggestions or next steps");
});

test("Copilot builds lead automation from simple prompt: new lead to sheets and Slack", async () => {
  const result = await copilotChat({
    prompt: "When a new lead comes in, save it to Google Sheets and notify Slack",
    mode: "auto_build",
  });

  assert.ok(result.reply, "Copilot should reply");
  const graph = result.graph;
  assert.ok(graph, "Should return a graph");
  
  // Should have at least 2 nodes: trigger + action
  assert.ok(graph!.nodes.length >= 2, `Should have at least 2 nodes, got ${graph!.nodes.length}`);
  
  // Should have a trigger
  const trigger = graph!.nodes.find((n) => n.type === "trigger");
  assert.ok(trigger, "Should have a trigger node");
  
  // Should be marked as rebuilt or inspect
  assert.ok(result.chapter, "Should have a chapter");
});

test("Copilot handles multi-turn lead automation refinement", async () => {
  // Build initial workflow
  const initial = await copilotChat({
    prompt: "When a form is submitted, add the lead to Google Sheets",
    mode: "auto_build",
  });
  assert.ok(initial.graph, "Initial build should produce a graph");
  assert.ok(initial.graph!.nodes.length >= 2, "Should have at least trigger + sheets");
  
  // Refine: add Slack notification
  const refined = await copilotChat({
    prompt: "Add Slack notification after the sheets step",
    graph: initial.graph!,
    mode: "auto_build",
  });
  assert.ok(refined.reply, "Refinement should reply");
  // The reply should contain actionable guidance or show the updated graph
  assert.ok(refined.reply.length > 10, "Refinement reply should be substantive");
});

test("Copilot conversational fallback routes general questions", async () => {
  // When there's no AI service, general questions fall through to the
  // orchestrator which returns a workflow description. When there IS an
  // AI service, the LLM answers directly. Either outcome is valid.
  const result = await copilotChat({
    prompt: "What is a webhook?",
    mode: "auto_build",
  });
  assert.ok(result.reply, "Should reply to a general question");
  assert.ok(result.reply.length > 10, "Reply should be substantive");
  // Source is either copilot-llm (AI service present) or copilot (heuristic fallback)
  assert.ok(["copilot-llm", "copilot"].includes(result.source), `Source should be copilot-llm or copilot, got ${result.source}`);
});

test("Copilot conversational fallback handles questions with history context", async () => {
  const history = [
    { role: "user" as const, content: "Create a lead automation from forms to sheets" },
    { role: "assistant" as const, content: "I created a workflow with a form trigger connected to Google Sheets." },
  ];
  const result = await copilotChat({
    prompt: "Can I add email notifications too?",
    history,
    mode: "auto_build",
  });
  assert.ok(result.reply, "Should reply with history context");
  // Should be either a workflow modification or an LLM answer
  assert.ok(result.source, "Should indicate source");
});
