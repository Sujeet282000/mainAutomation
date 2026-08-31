import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyQuery,
  respondToGeneralKnowledge,
  respondToCodeGeneration,
  respondToContentCreation,
  respondToPlatformHelp,
  respondToCompound,
  type ClassifiedQuery,
  type QueryCategory,
} from "./universal-query-handler";

// ── Deterministic pattern classification tests ───────────────────────────────

test("classifyQuery detects workflow build queries", async () => {
  const q = await classifyQuery("Create a workflow that sends Slack notifications when a Gmail arrives");
  assert.equal(q.category, "workflow_build");
  assert.ok(q.entities.includes("Slack"));
  assert.ok(q.entities.includes("Gmail"));
  assert.ok(q.requiresWorkflow);
});

test("classifyQuery detects workflow explain queries", async () => {
  const q = await classifyQuery("Explain this workflow");
  assert.equal(q.category, "workflow_explain");
  assert.ok(q.requiresWorkflow);
});

test("classifyQuery detects workflow debug queries", async () => {
  const q = await classifyQuery("Why did my workflow fail?");
  assert.equal(q.category, "workflow_debug");
  assert.ok(q.requiresWorkflow);
});

test("classifyQuery detects code generation queries", async () => {
  const q = await classifyQuery("Write a JavaScript function to parse email addresses");
  assert.equal(q.category, "code_generation");
  assert.ok(q.entities.includes("email"));
});

test("classifyQuery detects content creation queries", async () => {
  const q = await classifyQuery("Draft an email subject line for a product launch");
  assert.equal(q.category, "content_creation");
});

test("classifyQuery detects platform help queries", async () => {
  const q = await classifyQuery("How do I connect my Gmail account?");
  assert.equal(q.category, "platform_help");
  assert.ok(q.entities.includes("Gmail"));
});

test("classifyQuery detects conversational queries", async () => {
  const q = await classifyQuery("hello");
  assert.equal(q.category, "conversational");
  assert.ok(q.confidence >= 0.9);
});

test("classifyQuery detects system design queries", async () => {
  const q = await classifyQuery("Design an architecture for a customer onboarding system");
  assert.equal(q.category, "system_design");
  assert.ok(q.requiresWorkflow);
});

test("classifyQuery detects data analysis queries", async () => {
  const q = await classifyQuery("Analyze the performance of my automations over the last month");
  assert.equal(q.category, "data_analysis");
});

test("classifyQuery detects compound queries", async () => {
  const q = await classifyQuery("Build a workflow for email notifications and also write a JavaScript function to format dates");
  assert.equal(q.category, "compound");
  assert.ok(q.compoundParts && q.compoundParts.length >= 2);
});

test("classifyQuery falls back to general knowledge for ambiguous queries", async () => {
  const q = await classifyQuery("What is the best approach for handling retries in API integrations?");
  // Should be classified as general knowledge (question format)
  assert.ok(["general_knowledge", "platform_help", "system_design"].includes(q.category));
  assert.ok(q.confidence >= 0.5);
});

test("classifyQuery extracts app entities", async () => {
  const q = await classifyQuery("How do I use HubSpot with Salesforce?");
  assert.ok(q.entities.includes("HubSpot"));
  assert.ok(q.entities.includes("Salesforce"));
});

test("classifyQuery extracts field entities", async () => {
  const q = await classifyQuery("Map the email and subject fields between steps");
  assert.ok(q.entities.includes("email"));
  assert.ok(q.entities.includes("subject"));
});

// ── Deterministic tests for exported functions (no LLM required) ────────────

test("respondToGeneralKnowledge returns a reply object", async () => {
  const response = await respondToGeneralKnowledge("What is a webhook?");
  assert.ok(response.reply, "Should have a reply");
  assert.equal(response.category, "general_knowledge");
  assert.equal(response.source, "universal-llm");
  // The LLM may not be available in test, so check for fallback
  assert.ok(response.reply.length > 0);
});

test("respondToCodeGeneration returns a reply object", async () => {
  const response = await respondToCodeGeneration("Write a regex to extract domains from emails");
  assert.ok(response.reply, "Should have a reply");
  assert.equal(response.category, "code_generation");
  assert.equal(response.source, "universal-llm-code");
});

test("respondToContentCreation returns a reply object", async () => {
  const response = await respondToContentCreation("Draft a welcome email subject line");
  assert.ok(response.reply, "Should have a reply");
  assert.equal(response.category, "content_creation");
  assert.equal(response.source, "universal-llm-content");
});

test("respondToPlatformHelp returns a reply object", async () => {
  const response = await respondToPlatformHelp("How do I set up a webhook trigger?");
  assert.ok(response.reply, "Should have a reply");
  assert.equal(response.category, "platform_help");
  assert.equal(response.source, "universal-llm-help");
});

test("respondToCompound handles multiple parts", async () => {
  const response = await respondToCompound([
    { prompt: "What is a webhook?", category: "general_knowledge" },
    { prompt: "Write a regex for email", category: "code_generation" },
  ]);
  assert.ok(response.reply, "Should have a reply");
  assert.equal(response.category, "compound");
  assert.ok(response.reply.includes("webhook") || response.reply.includes("regex"), "Reply should reference the parts");
});

// ── Non-workflow queries should NOT trigger workflow behavior ────────────────

test("General knowledge queries do not require workflow context", async () => {
  const q = await classifyQuery("What is OAuth?");
  assert.ok(!q.requiresWorkflow, "OAuth question should not require a workflow");
});

test("Code queries do not require tools", async () => {
  const q = await classifyQuery("Write a SQL query to count users");
  assert.equal(q.category, "code_generation");
  assert.ok(!q.requiresTools, "Code generation should not require tools");
});

test("Content queries do not require tools", async () => {
  const q = await classifyQuery("Compose a professional email about project status");
  assert.equal(q.category, "content_creation");
  assert.ok(!q.requiresTools, "Content creation should not require tools");
});
