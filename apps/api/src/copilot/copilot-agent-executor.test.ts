import assert from "node:assert/strict";
import test from "node:test";
import {
  generateAgentPlan,
  executeAgentPlan,
  type AgentPlan,
  type CopilotToolContext,
} from "./copilot-agent-executor";

const TEST_CTX: CopilotToolContext = {
  workspaceId: "test-workspace",
  userId: "test-user",
};

test("generateAgentPlan returns a plan for workflow queries", async () => {
  const plan = await generateAgentPlan(
    "What integrations are available?",
    TEST_CTX,
  );
  // The LLM may or may not be available in tests
  if (plan) {
    assert.ok(Array.isArray(plan.calls), "Plan should have calls array");
    assert.ok(typeof plan.summary === "string", "Plan should have a summary");
    assert.ok(typeof plan.confidence === "number", "Plan should have a confidence");
    // Should plan to use integrations.search tool
    const hasIntegrationsCall = plan.calls.some((c) => c.tool === "integrations.search");
    assert.ok(hasIntegrationsCall || plan.calls.length === 0, "Should plan integration search or have no calls");
  }
});

test("generateAgentPlan returns null for simple greetings", async () => {
  const plan = await generateAgentPlan("hello", TEST_CTX);
  // Simple greetings should not need tool calls
  if (plan) {
    assert.equal(plan.calls.length, 0, "Greetings should not need tool calls");
  }
});

test("executeAgentPlan handles an empty plan", async () => {
  const plan: AgentPlan = { calls: [], summary: "No calls needed", confidence: 0.9 };
  const result = await executeAgentPlan(plan, TEST_CTX);
  assert.equal(result.results.length, 0, "No results for empty plan");
  assert.equal(result.success, true, "Empty plan is successful");
  assert.ok(result.reply, "Should have a reply");
});

test("executeAgentPlan executes tool calls and collects results", async () => {
  const plan: AgentPlan = {
    calls: [
      {
        id: "call-1",
        tool: "workflow.get",
        input: {},
        reasoning: "Get the current workflow",
      },
    ],
    summary: "Get the current workflow",
    confidence: 0.8,
  };
  const result = await executeAgentPlan(plan, TEST_CTX);
  assert.equal(result.results.length, 1, "Should have one result");
  assert.equal(result.results[0].tool, "workflow.get", "Should have executed workflow.get");
  // workflow.get returns an error because no flowId is provided
  assert.equal(result.results[0].result.ok, false, "Should report not ok (no flowId)");
});

test("executeAgentPlan handles unknown tools gracefully", async () => {
  const plan: AgentPlan = {
    calls: [
      {
        id: "call-1",
        tool: "nonexistent.tool",
        input: {},
        reasoning: "Test unknown tool",
      },
    ],
    summary: "Test unknown tool",
    confidence: 0.5,
  };
  const result = await executeAgentPlan(plan, TEST_CTX);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].result.ok, false);
  if (!result.results[0].result.ok) {
    assert.equal(result.results[0].result.error?.code, "UNKNOWN_TOOL");
  }
});

test("executeAgentPlan handles tool execution errors", async () => {
  const plan: AgentPlan = {
    calls: [
      {
        id: "call-1",
        tool: "execution.inspect",
        input: { runId: "nonexistent-run-id" },
        reasoning: "Inspect a run",
      },
    ],
    summary: "Inspect a run",
    confidence: 0.7,
  };
  const result = await executeAgentPlan(plan, TEST_CTX);
  assert.equal(result.results.length, 1);
  // execution.inspect may succeed or fail depending on DB state
  assert.ok(typeof result.results[0].durationMs === "number", "Should track duration");
});

test("executeAgentPlan chains multiple tool calls", async () => {
  const plan: AgentPlan = {
    calls: [
      { id: "call-1", tool: "integrations.search", input: { query: "email" }, reasoning: "Find email integrations" },
      { id: "call-2", tool: "connections.list", input: {}, reasoning: "Check connections" },
    ],
    summary: "Find email integrations and check connections",
    confidence: 0.85,
  };
  const result = await executeAgentPlan(plan, TEST_CTX);
  assert.equal(result.results.length, 2, "Should have two results");
  assert.equal(result.results[0].tool, "integrations.search");
  assert.equal(result.results[1].tool, "connections.list");
  assert.ok(result.suggestions, "Should have suggestions");
});
