import assert from "node:assert/strict";
import test from "node:test";
import { APP_CATALOG, getApp, listCatalogApps } from "./catalog";
import { graphFromCatalogPicks, graphFromPrompt, isCatalogGraph } from "./copilot";

test("catalog seed covers 33-category apps with unique slugs", () => {
  const slugs = APP_CATALOG.map((a) => a.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.ok(APP_CATALOG.length >= 80);
  assert.ok(getApp("klaviyo"));
  assert.ok(getApp("rss"));
  assert.ok(getApp("docusign"));
  assert.ok(getApp("postgresql"));
  assert.ok(listCatalogApps("shopify").some((a) => a.slug === "shopify"));
});

test("catalog graph from Copilot picks is valid", () => {
  const graph = graphFromCatalogPicks({
    trigger: { slug: "gmail", key: "new_email" },
    actions: [{ slug: "klaviyo", key: "add_profile" }]
  });
  assert.ok(graph);
  assert.equal(isCatalogGraph(graph), true);
});

test("prompt matching finds directory apps", () => {
  const graph = graphFromPrompt("When a Shopify order is created, then notify Slack");
  assert.equal(graph.nodes[0]?.appSlug, "shopify");
  assert.ok(graph.nodes.some((n) => n.appSlug === "slack"));
});
