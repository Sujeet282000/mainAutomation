import assert from "node:assert/strict";
import test from "node:test";
import { parseIntentHeuristic, runCopilotEngine, shouldRunFullEngine } from "./copilot-engine";
import { isStarterDraft } from "./copilot-orchestrator";

test("intent parse splits trigger and actions", () => {
  const intent = parseIntentHeuristic("When a Gmail arrives, then add a Sheets row, then notify Slack");
  assert.match(intent.trigger.phrase, /gmail/i);
  assert.ok(intent.steps.length >= 1);
});

test("full engine runs for starter drafts and complete workflow descriptions", () => {
  assert.equal(shouldRunFullEngine("When Gmail arrives add Sheets row", null), true);
  assert.equal(
    shouldRunFullEngine("fill step 2", {
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          appSlug: "gmail",
          operation: "new_email",
          label: "New Email",
          position: { x: 0, y: 0 },
          config: {},
          connectionId: null
        }
      ],
      edges: []
    }),
    false
  );
  assert.equal(
    shouldRunFullEngine("When a Gmail email arrives, then append a Google Sheets row", {
      nodes: [
        { id: "trigger", type: "trigger", appSlug: "webhook", operation: "catch_hook", label: "Catch Hook", position: { x: 0, y: 0 }, config: {}, connectionId: null },
        { id: "action", type: "action", appSlug: "http", operation: "request", label: "Request", position: { x: 0, y: 160 }, config: { url: "https://example.com" }, connectionId: null }
      ],
      edges: [{ id: "e", source: "trigger", target: "action" }]
    }),
    true
  );
  assert.equal(isStarterDraft({ nodes: [], edges: [] }), true);
});

test("copilot engine streams stages and produces a catalog draft", async () => {
  const events: string[] = [];
  let result: { graph: { nodes: Array<{ appSlug: string }> }; source: string } | null = null;
  for await (const ev of runCopilotEngine({
    prompt: "When a Gmail arrives, add a Google Sheets row",
    mode: "auto_build",
    graph: null
  })) {
    if (ev.type === "stage") events.push(ev.stage);
    if (ev.type === "result") result = ev.result;
  }
  assert.ok(events.includes("intent"));
  assert.ok(events.includes("retrieve"));
  assert.ok(events.includes("connect"));
  assert.ok(events.includes("map"));
  assert.ok(events.includes("persist"));
  assert.ok(result?.graph.nodes.length);
  assert.equal(result?.source, "copilot-engine");
  assert.equal(result?.graph.nodes[0]?.appSlug, "gmail");
  assert.ok(result?.graph.nodes.some((n) => n.appSlug === "google-sheets"));
});
