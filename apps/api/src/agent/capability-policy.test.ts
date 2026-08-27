import assert from "node:assert/strict";
import test from "node:test";
import { capabilityForAgentOperation, decideCapability } from "./capability-policy";

test("read-only capabilities never require approval", () => {
  assert.deepEqual(decideCapability("READ_WORKFLOW"), {
    allowed: true,
    requiresApproval: false,
    reason: "read-only capability"
  });
  assert.deepEqual(decideCapability("VALIDATE_WORKFLOW"), {
    allowed: true,
    requiresApproval: false,
    reason: "read-only capability"
  });
});

test("workflow mutations are allowed but remain workflow-scoped", () => {
  assert.equal(decideCapability("ADD_NODE").allowed, true);
  assert.equal(decideCapability("CONFIGURE_NODE").requiresApproval, false);
  assert.equal(decideCapability("TEST_WORKFLOW").allowed, true);
});

test("high-impact actions require explicit approval", () => {
  assert.equal(decideCapability("PUBLISH_WORKFLOW").allowed, false);
  assert.equal(decideCapability("PUBLISH_WORKFLOW").requiresApproval, true);
  assert.equal(decideCapability("PUBLISH_WORKFLOW", { explicitApproval: true }).allowed, true);
  assert.equal(decideCapability("SEND_EXTERNAL_MESSAGE").allowed, false);
});

test("AgentOperation types map to policy capabilities", () => {
  assert.equal(capabilityForAgentOperation("ADD_NODE"), "ADD_NODE");
  assert.equal(capabilityForAgentOperation("TEST_WORKFLOW"), "TEST_WORKFLOW");
  assert.equal(capabilityForAgentOperation("UNKNOWN"), null);
});
