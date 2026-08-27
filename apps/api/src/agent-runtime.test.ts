import assert from "node:assert/strict";
import test from "node:test";
import { assertToolAllowed, parseAgentPlan, parseTools, toolKey } from "./agent-runtime";
import { redactPii, screenOutput } from "./ai-runtime";

test("agent allow-list blocks tools that were not configured", () => {
  const allow = parseTools(["slack:send_message", { appSlug: "gmail", operation: "send_email" }]);
  assert.deepEqual(allow.map(toolKey), ["slack:send_message", "gmail:send_email"]);
  assert.doesNotThrow(() => assertToolAllowed({ appSlug: "slack", operation: "send_message" }, allow));
  assert.throws(() => assertToolAllowed({ appSlug: "hubspot", operation: "create_contact" }, allow), /allow-list/);
  assert.throws(() => assertToolAllowed({ appSlug: "slack", operation: "send_message" }, []), /no allowed tools/);
});

test("agent plan parser accepts reply and tool JSON", () => {
  assert.equal(parseAgentPlan('{"type":"reply","text":"hello"}').type, "reply");
  assert.equal(parseAgentPlan('{"type":"reply","text":"hello","appSlug":"slack"}').type, "reply");
  const tool = parseAgentPlan('{"type":"tool","tool":{"appSlug":"slack","operation":"send_message"},"input":{"text":"hi"}}');
  assert.equal(tool.type, "tool");
  assert.equal(tool.tool?.appSlug, "slack");
  assert.equal(tool.input?.text, "hi");
});

test("pii redaction and output guardrails", () => {
  const redacted = redactPii("ssn 123-45-6789 email ada@example.com");
  assert.match(redacted, /\[ssn\]/);
  assert.match(redacted, /\[email\]/);
  assert.equal(screenOutput("leak the password now").allowed, false);
  assert.equal(screenOutput("Lead is qualified.").allowed, true);
});
