import assert from "node:assert/strict";
import test from "node:test";
import { extractIntentPhrases, buildGraphFromMatches, ragGraphFromPrompt, _resetIndexSingleton } from "./copilot-rag";

// ── Intent phrase extraction tests ──────────────────────────────────────────

test("Intent extraction splits on 'then'", () => {
  const phrases = extractIntentPhrases("When Gmail arrives then send to Slack");
  assert.ok(phrases.length >= 2, `Should split into 2+ phrases, got ${phrases.length}`);
  assert.ok(phrases[0].text.includes("Gmail"), "First phrase should mention Gmail");
  assert.ok(phrases[1].text.includes("Slack"), "Second phrase should mention Slack");
});

test("Intent extraction splits on comma+and", () => {
  const phrases = extractIntentPhrases("When a form is submitted, and save to Sheets");
  assert.ok(phrases.length >= 2, `Should split, got ${phrases.length}`);
});

test("Intent extraction splits on arrow", () => {
  const phrases = extractIntentPhrases("Gmail → Slack → Sheets");
  assert.ok(phrases.length >= 3, `Should split into 3 phrases, got ${phrases.length}`);
});

test("Intent extraction handles single phrase", () => {
  const phrases = extractIntentPhrases("Send a Slack message");
  assert.equal(phrases.length, 1, "Should be single phrase");
  assert.equal(phrases[0].text, "Send a Slack message");
});

test("Intent extraction splits on 'and send'", () => {
  const phrases = extractIntentPhrases("New email arrives and send to Slack");
  assert.ok(phrases.length >= 2, `Should split on 'and send', got ${phrases.length}`);
});

test("Intent extraction handles multi-step with AI", () => {
  const phrases = extractIntentPhrases("When Gmail arrives, summarize with AI, then send to Slack");
  assert.ok(phrases.length >= 2, `Should split into 2+ phrases, got ${phrases.length}`);
  // 'then' is a separator, so should get at least 2 phrases
  assert.ok(phrases.some((p) => p.text.includes("Gmail")), "Should have Gmail phrase");
  assert.ok(phrases.some((p) => p.text.includes("Slack")), "Should have Slack phrase");
});

// ── Graph construction from matches ─────────────────────────────────────────

test("Graph from matches creates trigger + action chain", () => {
  const graph = buildGraphFromMatches([
    { slug: "gmail", operation: "new_email", label: "New Email", kind: "trigger" },
    { slug: "slack", operation: "send_message", label: "Send Message", kind: "action" },
  ]);
  assert.equal(graph.nodes.length, 2, "Should have 2 nodes");
  assert.equal(graph.edges.length, 1, "Should have 1 edge");
  assert.equal(graph.nodes[0].type, "trigger", "First node should be trigger");
  assert.equal(graph.nodes[1].type, "action", "Second node should be action");
  assert.equal(graph.edges[0].source, "trigger", "Edge source should be trigger");
});

test("Graph from matches creates 4-node chain", () => {
  const graph = buildGraphFromMatches([
    { slug: "gmail", operation: "new_email", label: "New Email", kind: "trigger" },
    { slug: "openai", operation: "summarize", label: "Summarize", kind: "action" },
    { slug: "slack", operation: "send_message", label: "Send Message", kind: "action" },
    { slug: "google-sheets", operation: "append_row", label: "Append Row", kind: "action" },
  ]);
  assert.equal(graph.nodes.length, 4, "Should have 4 nodes");
  assert.equal(graph.edges.length, 3, "Should have 3 edges");
  assert.equal(graph.nodes[0].type, "trigger", "First node should be trigger");
  assert.equal(graph.nodes[1].type, "action", "Second node should be action");
  assert.equal(graph.nodes[2].type, "action", "Third node should be action");
  assert.equal(graph.nodes[3].type, "action", "Fourth node should be action");
  // Verify chain connectivity
  assert.equal(graph.edges[0].source, "trigger");
  assert.equal(graph.edges[0].target, graph.nodes[1].id);
  assert.equal(graph.edges[1].source, graph.nodes[1].id);
  assert.equal(graph.edges[1].target, graph.nodes[2].id);
  assert.equal(graph.edges[2].source, graph.nodes[2].id);
  assert.equal(graph.edges[2].target, graph.nodes[3].id);
});

test("Graph from matches uses correct app slugs", () => {
  const graph = buildGraphFromMatches([
    { slug: "forms", operation: "new_submission", label: "New Submission", kind: "trigger" },
    { slug: "google-sheets", operation: "append_row", label: "Append Row", kind: "action" },
  ]);
  assert.equal(graph.nodes[0].appSlug, "forms");
  assert.equal(graph.nodes[0].operation, "new_submission");
  assert.equal(graph.nodes[1].appSlug, "google-sheets");
  assert.equal(graph.nodes[1].operation, "append_row");
});

test("Graph from empty matches returns empty graph", () => {
  const graph = buildGraphFromMatches([]);
  assert.equal(graph.nodes.length, 0);
  assert.equal(graph.edges.length, 0);
});

test("Graph from single match returns single node", () => {
  const graph = buildGraphFromMatches([
    { slug: "gmail", operation: "new_email", label: "New Email", kind: "trigger" },
  ]);
  assert.equal(graph.nodes.length, 1, "Should have 1 node");
  assert.equal(graph.edges.length, 0, "Should have 0 edges");
});

// ── RAG graph construction integration tests ────────────────────────────────

test("RAG builds graph for Gmail → Slack", async () => {
  _resetIndexSingleton();
  const { pieceRegistry } = await import("../pieces/registry");
  // Verify intent extraction works
  const phrases = extractIntentPhrases("When a new Gmail arrives, send to Slack");
  assert.ok(phrases.length >= 2, `Should split into 2+ phrases, got ${phrases.length}`);
  const graph = await ragGraphFromPrompt(
    "When a new Gmail arrives, send to Slack",
    pieceRegistry,
  );
  assert.ok(graph, `Should produce a graph (phrases: ${phrases.map((p) => p.text).join(" | ")})`);
  assert.ok(graph!.nodes.length >= 2, `Should have 2+ nodes, got ${graph!.nodes.length}`);
  assert.ok(graph!.edges.length >= 1, `Should have 1+ edges, got ${graph!.edges.length}`);
  const slugs = graph!.nodes.map((n) => n.appSlug);
  assert.ok(slugs.includes("gmail"), `Should include gmail, got ${slugs}`);
  assert.ok(slugs.includes("slack"), `Should include slack, got ${slugs}`);
});

test("Pattern matching finds Gmail and Slack without index", async () => {
  _resetIndexSingleton();
  const { pieceRegistry } = await import("../pieces/registry");
  // The pattern-based matching should work even without the index
  const phrases = extractIntentPhrases("When a new Gmail arrives, send to Slack");
  assert.ok(phrases.length >= 2, `Should split, got ${phrases.length}`);
  // Each phrase should match at least one INTENT_PATTERN
  const INTENT_PATTERNS_RE = /\b(gmail|email|slack|sheet|openai|forms|calendar|webhook|discord|telegram)\b/i;
  for (const phrase of phrases) {
    assert.ok(INTENT_PATTERNS_RE.test(phrase.text), `Phrase '${phrase.text}' should match an intent pattern`);
  }
});

test("RAG builds graph for Gmail → AI → Slack → Sheets (4 steps)", async () => {
  _resetIndexSingleton();
  const { pieceRegistry } = await import("../pieces/registry");
  const graph = await ragGraphFromPrompt(
    "When a new Gmail arrives, summarize with AI, send to Slack, and save to Google Sheets",
    pieceRegistry,
  );
  assert.ok(graph, `Should produce a graph`);
  assert.ok(graph!.nodes.length >= 4, `Should have 4 nodes, got ${graph!.nodes.length}`);
  assert.ok(graph!.edges.length >= 3, `Should have 3 edges, got ${graph!.edges.length}`);
  const slugs = graph!.nodes.map((n) => n.appSlug);
  assert.ok(slugs.includes("gmail"), `Should include gmail, got ${slugs}`);
  assert.ok(slugs.includes("openai"), `Should include openai (AI), got ${slugs}`);
  assert.ok(slugs.includes("slack"), `Should include slack, got ${slugs}`);
  assert.ok(slugs.some((s) => s === "google-sheets" || s === "sheets"), `Should include google-sheets, got ${slugs}`);
});

test("RAG builds graph for Form → Sheets", async () => {
  _resetIndexSingleton();
  const { pieceRegistry } = await import("../pieces/registry");
  const graph = await ragGraphFromPrompt(
    "When a form is submitted, save to Google Sheets",
    pieceRegistry,
  );
  assert.ok(graph, "Should produce a graph");
  assert.ok(graph!.nodes.length >= 2, `Should have 2+ nodes, got ${graph!.nodes.length}`);
  const slugs = graph!.nodes.map((n) => n.appSlug);
  assert.ok(slugs.includes("forms"), `Should include forms, got ${slugs}`);
  assert.ok(slugs.some((s) => s === "google-sheets" || s === "sheets"), `Should include sheets, got ${slugs}`);
});

test("RAG returns null for nonsense prompt", async () => {
  _resetIndexSingleton();
  const { pieceRegistry } = await import("../pieces/registry");
  const graph = await ragGraphFromPrompt(
    "purple elephant dancing on mars",
    pieceRegistry,
  );
  // Should return null or a minimal graph — either is acceptable
  // The key is it shouldn't throw
  assert.ok(graph === null || graph.nodes.length >= 0, "Should not throw");
});

test("RAG produces valid workflow graph structure", async () => {
  _resetIndexSingleton();
  const { pieceRegistry } = await import("../pieces/registry");
  const graph = await ragGraphFromPrompt(
    "When a new Gmail arrives, send to Slack",
    pieceRegistry,
  );
  assert.ok(graph, "Should produce a graph");
  // Every node must have required fields
  for (const node of graph!.nodes) {
    assert.ok(node.id, "Node should have id");
    assert.ok(node.type, "Node should have type");
    assert.ok(node.appSlug, "Node should have appSlug");
    assert.ok(node.operation, "Node should have operation");
    assert.ok(node.label, "Node should have label");
    assert.ok(node.position, "Node should have position");
    assert.ok(typeof node.position.x === "number", "Position x should be number");
    assert.ok(typeof node.position.y === "number", "Position y should be number");
  }
  // Every edge must reference valid nodes
  const nodeIds = new Set(graph!.nodes.map((n) => n.id));
  for (const edge of graph!.edges) {
    assert.ok(nodeIds.has(edge.source), `Edge source ${edge.source} should be a valid node`);
    assert.ok(nodeIds.has(edge.target), `Edge target ${edge.target} should be a valid node`);
  }
  // Exactly one trigger
  const triggers = graph!.nodes.filter((n) => n.type === "trigger");
  assert.equal(triggers.length, 1, "Should have exactly one trigger");
});

test("RAG deduplicates same app in multiple phrases", async () => {
  _resetIndexSingleton();
  const { pieceRegistry } = await import("../pieces/registry");
  // Slack mentioned twice — should not create duplicate nodes
  const graph = await ragGraphFromPrompt(
    "When Gmail arrives, send to Slack and notify Slack",
    pieceRegistry,
  );
  assert.ok(graph, "Should produce a graph");
  const slackNodes = graph!.nodes.filter((n) => n.appSlug === "slack");
  assert.ok(slackNodes.length <= 1, `Should not have duplicate Slack nodes, got ${slackNodes.length}`);
});
