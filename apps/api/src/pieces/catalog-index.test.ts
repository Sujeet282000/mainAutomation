import assert from "node:assert/strict";
import test from "node:test";
import { CatalogIndex } from "./catalog-index";
import { ModelGateway } from "@algoverge/model-gateway";
import { pieceRegistry } from "./registry";

test("CatalogIndex reindex populates rows", async () => {
  const index = new CatalogIndex(pieceRegistry, new ModelGateway());
  await index.reindex();
  const results = await index.search("gmail email", "trigger", 5);
  assert.ok(results.length > 0, "Should find Gmail trigger");
  assert.ok(results.some((r) => r.piece === "gmail"), "Should find gmail piece");
});

test("CatalogIndex search finds correct trigger", async () => {
  const index = new CatalogIndex(pieceRegistry, new ModelGateway());
  await index.reindex();
  const results = await index.search("new email arrives", "trigger", 5);
  assert.ok(results.length > 0, "Should find results");
  assert.ok(results[0].piece === "gmail", `First result should be gmail, got ${results[0].piece}`);
  assert.equal(results[0].kind, "trigger", "Should be a trigger");
});

test("CatalogIndex search finds correct action", async () => {
  const index = new CatalogIndex(pieceRegistry, new ModelGateway());
  await index.reindex();
  const results = await index.search("send slack message", "action", 5);
  assert.ok(results.length > 0, "Should find results");
  assert.ok(results.some((r) => r.piece === "slack"), "Should find slack action");
});

test("CatalogIndex search finds Google Sheets", async () => {
  const index = new CatalogIndex(pieceRegistry, new ModelGateway());
  await index.reindex();
  const results = await index.search("append row to spreadsheet", "action", 5);
  assert.ok(results.length > 0, "Should find results");
  assert.ok(results.some((r) => r.piece === "google-sheets"), "Should find google-sheets");
});

test("CatalogIndex hybrid search: vector + lexical", async () => {
  const index = new CatalogIndex(pieceRegistry, new ModelGateway());
  await index.reindex();
  // Search with a phrase that matches lexically but not exactly
  const results = await index.search("summarize text with artificial intelligence", "action", 5);
  assert.ok(results.length > 0, "Should find results");
  // Should find openai as a top result
  assert.ok(results.some((r) => r.piece === "openai"), `Should find openai, got ${results.map((r) => r.piece).join(", ")}`);
});

test("CatalogIndex search without kind filter", async () => {
  const index = new CatalogIndex(pieceRegistry, new ModelGateway());
  await index.reindex();
  const results = await index.search("calendar event", undefined, 10);
  assert.ok(results.length > 0, "Should find results");
  assert.ok(results.some((r) => r.piece === "google-calendar"), "Should find google-calendar");
});

test("CatalogIndex works with empty reindex (no crash)", async () => {
  const index = new CatalogIndex(pieceRegistry, new ModelGateway());
  // Don't call reindex — search should fall back to lexical
  const results = await index.search("gmail", "trigger", 5);
  assert.ok(results.length > 0, "Should find results even without reindex");
});

test("CatalogIndex handles many results gracefully", async () => {
  const index = new CatalogIndex(pieceRegistry, new ModelGateway());
  await index.reindex();
  const results = await index.search("a", undefined, 50);
  assert.ok(results.length > 0, "Should return results");
  assert.ok(results.length <= 50, "Should respect k limit");
});

test("CatalogIndex search is consistent across calls", async () => {
  const index = new CatalogIndex(pieceRegistry, new ModelGateway());
  await index.reindex();
  const r1 = await index.search("slack send message", "action", 5);
  const r2 = await index.search("slack send message", "action", 5);
  assert.deepEqual(r1.map((r) => r.piece), r2.map((r) => r.piece), "Same query should return same results");
});
