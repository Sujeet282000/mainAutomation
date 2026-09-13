import assert from "node:assert/strict";
import test from "node:test";
import { expandConfiguredRouters } from "./router-compiler";

test("expands every configured router path instead of hard-coding two paths", () => {
  const definition: any = {
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [{ id: "paths", type: "router", branches: [{ id: "path_a", label: "old" }] }],
    settings: { timezone: "UTC" },
  };
  const graph: any = {
    nodes: [
      { id: "trigger", type: "trigger", appSlug: "manual", operation: "button", config: {} },
      { id: "paths", type: "logic", appSlug: "paths", operation: "router", config: {
        paths: [
          { id: "vip", label: "VIP" },
          { id: "standard", label: "Standard" },
          { id: "fallback", label: "Fallback", default: true },
        ],
      } },
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
  const expanded: any = expandConfiguredRouters(definition, graph);
  const branches = expanded.steps[0].branches;
  assert.deepEqual(branches.map((b: any) => b.id), ["vip", "standard", "fallback"]);
  assert.equal(branches[2].default, true);
});
