import assert from "node:assert/strict";
import test from "node:test";
import { MCP_TOOL_DEFS, toolAllowed, type McpSession } from "./mcp/defs";
import { getDynamicFieldsHandler } from "./adapters";

test("mcp tools have unique names and scope checks", () => {
  const names = MCP_TOOL_DEFS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  const session: McpSession = {
    tokenId: "t",
    workspaceId: "w",
    organizationId: "o",
    scopes: ["automations:read"]
  };
  assert.equal(toolAllowed(session, "list_automations"), true);
  assert.equal(toolAllowed(session, "run_automation"), false);
  assert.equal(toolAllowed({ ...session, scopes: ["tools:invoke"] }, "run_automation"), true);
});

test("dynamic fields resolve via adapter registry, not app-name branches", () => {
  assert.ok(getDynamicFieldsHandler("google-sheets"));
  assert.ok(getDynamicFieldsHandler("slack"));
  assert.equal(getDynamicFieldsHandler("unknown-app"), undefined);
});
