import assert from "node:assert/strict";
import test from "node:test";
import { expandConfiguredRouters } from "@algoverge/core";

test("router expansion preserves all configured paths", () => {
  const definition: any = {
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [{ id: "paths", type: "router", branches: [{ id: "legacy", label: "Legacy" }] }],
    settings: { timezone: "UTC" },
  };
  const graph: any = {
    nodes: [
      { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", config: {} },
      { id: "paths", type: "logic", appSlug: "paths", operation: "router", config: { paths: [
        { id: "vip", label: "VIP" },
        { id: "standard", label: "Standard" },
        { id: "fallback", label: "Fallback", default: true },
      ] } },
      { id: "vip_action", type: "action", appSlug: "http", operation: "request", config: {} },
      { id: "standard_action", type: "action", appSlug: "http", operation: "request", config: {} },
      { id: "fallback_action", type: "action", appSlug: "http", operation: "request", config: {} },
    ],
    edges: [
      { source: "paths", target: "vip_action", sourceHandle: "vip" },
      { source: "paths", target: "standard_action", sourceHandle: "standard" },
      { source: "paths", target: "fallback_action", sourceHandle: "fallback" },
    ],
  };
  const branches = (expandConfiguredRouters(definition, graph).steps[0] as any).branches;
  assert.deepEqual(branches.map((b: any) => b.id), ["vip", "standard", "fallback"]);
  assert.equal(branches[2].default, true);
});
