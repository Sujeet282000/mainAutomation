import assert from "node:assert/strict";
import test from "node:test";
import {
  definitionHash,
  evaluateFlowCondition,
  flowDefinitionToGraph,
  graphToFlowDefinition,
  parseFlowDefinition,
  resolveValue,
  safeParseFlowDefinition
} from "@algoverge/core";
import { decodeSealed, encodeSealed, isEnvelopeBlob, LocalKms, openSync, sealSync } from "@algoverge/crypto";
import { inferSideEffect } from "@algoverge/pieces-sdk";

test("FlowDefinition parses Orchestra step types and rejects credentials", () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      {
        id: "step_1",
        type: "piece_action",
        piece: { name: "slack" },
        operation: "send_message",
        connectionId: null,
        props: { text: "hi" }
      }
    ],
    settings: { timezone: "UTC" }
  });
  assert.equal(def.steps[0].type, "piece_action");
  const bad = safeParseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      {
        id: "step_1",
        type: "http",
        props: { method: "POST", url: "https://example.com", apiKey: "secret" }
      }
    ]
  });
  assert.equal(bad.success, false);
});

test("builder graphs round-trip through FlowDefinition", () => {
  const graph = {
    nodes: [
      {
        id: "trigger",
        type: "trigger" as const,
        appSlug: "gmail",
        operation: "new_email",
        label: "New Email",
        position: { x: 0, y: 0 },
        config: {},
        connectionId: null
      },
      {
        id: "action",
        type: "action" as const,
        appSlug: "slack",
        operation: "send_message",
        label: "Send",
        position: { x: 0, y: 160 },
        config: { text: "{{trigger.subject|upper}}" },
        connectionId: null
      }
    ],
    edges: [{ id: "e1", source: "trigger", target: "action" }]
  };
  const def = graphToFlowDefinition(graph);
  const back = flowDefinitionToGraph(def);
  assert.equal(back.nodes.some((n) => n.appSlug === "slack"), true);
  assert.ok(definitionHash(def).length === 64);
});

test("expression resolver preserves types and pipe filters", () => {
  const ctx = { trigger: { n: 3, name: "Ada" }, steps: {} };
  assert.equal(resolveValue("{{trigger.n}}", ctx), 3);
  assert.equal(resolveValue("{{trigger.name | upper}}", ctx), "ADA");
  assert.equal(evaluateFlowCondition({ op: "eq", left: "{{trigger.name}}", right: "Ada" }, ctx), true);
});

test("envelope encryption is org-scoped", () => {
  const kms = new LocalKms("test-secret");
  const sealed = sealSync(kms, "org-a", { token: "abc" });
  const blob = encodeSealed(sealed);
  assert.equal(isEnvelopeBlob(blob), true);
  assert.equal(openSync<{ token: string }>(kms, "org-a", decodeSealed(blob)).token, "abc");
  assert.throws(() => openSync(kms, "org-b", decodeSealed(blob)));
});

test("piece side effects follow operation names", () => {
  assert.equal(inferSideEffect("send_message"), "create");
  assert.equal(inferSideEffect("delete_row"), "delete");
});

test("first-party Slack piece is registered with spec operation cards", async () => {
  const { pieceRegistry } = await import("./pieces/registry");
  const action = pieceRegistry.getAction("slack", "send_message");
  assert.equal(action.sideEffect, "create");
  assert.ok(action.props.channel && action.props.text);
  const cards = pieceRegistry.cards().filter((c) => c.piece === "slack" && c.operation === "send_message");
  assert.equal(cards.length, 1);
  assert.ok(cards[0].aliases.includes("post to slack"));
});

test("catalog index hybrid search finds Slack send message", async () => {
  const { ModelGateway } = await import("@algoverge/model-gateway");
  const { pieceRegistry } = await import("./pieces/registry");
  const { CatalogIndex } = await import("./pieces/catalog-index");
  const index = new CatalogIndex(pieceRegistry, new ModelGateway());
  await index.reindex();
  const hits = await index.search("notify slack channel", "action", 8);
  assert.ok(hits.some((h) => h.piece === "slack" && h.operation === "send_message"));
});
