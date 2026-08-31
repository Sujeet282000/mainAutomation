// =============================================================================
// Copilot Agent Executor — Multi-step operation execution with tool chaining.
//
// This module enables the copilot to:
//   1. Plan a sequence of tool calls to fulfill complex requests
//   2. Execute tools from copilot-tools.ts with authorization
//   3. Chain tool results into follow-up actions
//   4. Handle partial failures gracefully
//   5. Generate a comprehensive response from tool results
//
// The agent operates within strict safety boundaries:
//   - Never executes destructive operations without approval
//   - Never creates credentials or stores secrets
//   - Never publishes workflows
//   - All tool calls are logged for audit
// =============================================================================

import type { WorkflowGraph } from "@algoverge/shared";
import { completeAi } from "../ai-runtime";
import { COPILOT_TOOLS, type CopilotToolContext, type CopilotToolResult } from "./copilot-tools";

// ── Agent Plan Types ────────────────────────────────────────────────────────

export interface AgentToolCall {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  reasoning: string;
}

export interface AgentPlan {
  calls: AgentToolCall[];
  summary: string;
  confidence: number;
}

export interface AgentExecutionResult {
  callId: string;
  tool: string;
  result: CopilotToolResult;
  durationMs: number;
}

export interface AgentResponse {
  reply: string;
  results: AgentExecutionResult[];
  toolCalls: AgentToolCall[];
  suggestions: Array<{ label: string; prompt: string }>;
  success: boolean;
}

// ── Available Tool Descriptions (for LLM planning) ──────────────────────────

const TOOL_DESCRIPTIONS = [
  {
    name: "workflow.get",
    description: "Get the current workflow definition, nodes, and edges",
    inputSchema: "{}",
    safeForAuto: true,
  },
  {
    name: "workflow.validate",
    description: "Validate the current workflow for issues and errors",
    inputSchema: "{}",
    safeForAuto: true,
  },
  {
    name: "integrations.search",
    description: "Search available integrations by keyword",
    inputSchema: "{ query: string }",
    safeForAuto: true,
  },
  {
    name: "integrations.schema",
    description: "Get the full schema (operations, fields) for a specific integration",
    inputSchema: "{ slug: string }",
    safeForAuto: true,
  },
  {
    name: "connections.list",
    description: "List the user's connected accounts, optionally filtered by app",
    inputSchema: "{ pieceName?: string }",
    safeForAuto: true,
  },
  {
    name: "execution.inspect",
    description: "Inspect a past workflow run including step-by-step results and errors",
    inputSchema: "{ runId: string }",
    safeForAuto: true,
  },
];

// ── Plan Generation ─────────────────────────────────────────────────────────

/**
 * Use the LLM to generate a plan of tool calls to answer a user query.
 * Returns null if no tools are needed (direct text response suffices).
 */
export async function generateAgentPlan(
  prompt: string,
  ctx: CopilotToolContext,
  graph?: WorkflowGraph | null,
): Promise<AgentPlan | null> {
  const contextDescription = [
    `Workspace: ${ctx.workspaceId}`,
    ctx.flowId ? `Current workflow: ${ctx.flowId}` : "No workflow selected",
    ctx.selectedNodeId ? `Selected node: ${ctx.selectedNodeId}` : "",
    graph?.nodes?.length
      ? `Workflow steps: ${graph.nodes.map((n) => `${n.label ?? n.appSlug} (${n.appSlug})`).join(", ")}`
      : "",
  ].filter(Boolean).join("\n");

  const result = await completeAi({
    intent: "reason",
    json: true,
    prompt: JSON.stringify({
      userRequest: prompt,
      context: contextDescription,
      availableTools: TOOL_DESCRIPTIONS,
    }),
    system: [
      "You are an AI agent that plans tool calls to answer user queries.",
      "Given a user request and available tools, produce a plan of tool calls.",
      "Return JSON: { calls: [{ id, tool, input, reasoning }], summary, confidence }",
      "Only use tools that are relevant to the request.",
      "If no tools are needed, return { calls: [], summary: 'No tool calls needed', confidence: 0.9 }",
      "Plan calls in logical order — earlier calls may inform later ones.",
      "Never plan destructive operations.",
      "Keep the plan to 1-4 tool calls maximum.",
    ].join("\n"),
  });

  if (!result.text) return null;

  try {
    const parsed = JSON.parse(result.text);
    if (!Array.isArray(parsed.calls)) return null;

    const validCalls: AgentToolCall[] = [];
    for (const call of parsed.calls) {
      if (call.tool && typeof call.tool === "string" && TOOL_DESCRIPTIONS.some((t) => t.name === call.tool)) {
        validCalls.push({
          id: call.id || `call-${validCalls.length + 1}`,
          tool: call.tool,
          input: typeof call.input === "object" && call.input ? call.input : {},
          reasoning: call.reasoning || "",
        });
      }
    }

    return {
      calls: validCalls,
      summary: parsed.summary || "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
    };
  } catch {
    return null;
  }
}

// ── Execution Engine ────────────────────────────────────────────────────────

/**
 * Execute a plan of tool calls and collect results.
 * Tools are executed sequentially — later tools can reference earlier results.
 */
export async function executeAgentPlan(
  plan: AgentPlan,
  ctx: CopilotToolContext,
): Promise<AgentResponse> {
  const results: AgentExecutionResult[] = [];
  const startTime = Date.now();

  for (const call of plan.calls) {
    const toolFn = COPILOT_TOOLS[call.tool];
    if (!toolFn) {
      results.push({
        callId: call.id,
        tool: call.tool,
        result: { ok: false, error: { code: "UNKNOWN_TOOL", message: `Tool "${call.tool}" not found` } },
        durationMs: 0,
      });
      continue;
    }

    const callStart = Date.now();
    try {
      const toolResult = await toolFn(ctx, call.input);
      results.push({
        callId: call.id,
        tool: call.tool,
        result: toolResult,
        durationMs: Date.now() - callStart,
      });
    } catch (err) {
      results.push({
        callId: call.id,
        tool: call.tool,
        result: {
          ok: false,
          error: {
            code: "EXECUTION_ERROR",
            message: err instanceof Error ? err.message : "Tool execution failed",
          },
        },
        durationMs: Date.now() - callStart,
      });
    }
  }

  // Generate a synthesized response from tool results
  const reply = await synthesizeResponse(plan, results, ctx);
  const suggestions = generateSuggestions(plan, results);

  return {
    reply,
    results,
    toolCalls: plan.calls,
    suggestions,
    success: results.every((r) => r.result.ok),
  };
}

// ── Response Synthesis ──────────────────────────────────────────────────────

/**
 * Use the LLM to synthesize a comprehensive answer from tool results.
 */
async function synthesizeResponse(
  plan: AgentPlan,
  results: AgentExecutionResult[],
  ctx: CopilotToolContext,
): Promise<string> {
  const toolOutputs = results.map((r) => ({
    tool: r.tool,
    callId: r.callId,
    success: r.result.ok,
    data: r.result.ok ? r.result.data : r.result.error,
    durationMs: r.durationMs,
  }));

  const result = await completeAi({
    intent: "reason",
    prompt: JSON.stringify({
      userRequest: plan.summary,
      toolResults: toolOutputs,
    }),
    system: [
      "You are an AI assistant that synthesizes tool results into a clear, helpful response.",
      "Summarize what was found and provide actionable guidance.",
      "Use markdown for readability.",
      "If tools failed, acknowledge the failure and suggest alternatives.",
      "Keep the response concise (2-4 paragraphs).",
      "End with a clear next step when appropriate.",
    ].join("\n"),
  });

  if (result.text) return result.text;

  // Fallback: construct a basic summary
  const successful = results.filter((r) => r.result.ok);
  const failed = results.filter((r) => !r.result.ok);

  const parts: string[] = [];
  if (successful.length) {
    parts.push(`Successfully retrieved information from ${successful.length} source(s).`);
  }
  if (failed.length) {
    parts.push(`${failed.length} operation(s) failed.`);
  }

  return parts.join(" ") || "I wasn't able to gather the information you requested.";
}

// ── Suggestion Generation ───────────────────────────────────────────────────

function generateSuggestions(
  plan: AgentPlan,
  results: AgentExecutionResult[],
): Array<{ label: string; prompt: string }> {
  const suggestions: Array<{ label: string; prompt: string }> = [];
  const toolsUsed = new Set(results.map((r) => r.tool));

  if (toolsUsed.has("workflow.get") || toolsUsed.has("workflow.validate")) {
    suggestions.push({ label: "Explain this workflow", prompt: "Explain this workflow in detail" });
    suggestions.push({ label: "Find problems", prompt: "Find problems in this workflow" });
  }

  if (toolsUsed.has("integrations.search") || toolsUsed.has("integrations.schema")) {
    suggestions.push({ label: "Build with this integration", prompt: "Create a workflow using this integration" });
  }

  if (toolsUsed.has("execution.inspect")) {
    suggestions.push({ label: "Fix the failure", prompt: "Fix the issue that caused the failure" });
    suggestions.push({ label: "Retry the run", prompt: "Retry the last workflow run" });
  }

  if (toolsUsed.has("connections.list")) {
    suggestions.push({ label: "Connect a new account", prompt: "I need to connect a new account" });
  }

  // Generic suggestions
  if (!suggestions.length) {
    suggestions.push({ label: "Ask another question", prompt: "I have another question" });
  }

  return suggestions.slice(0, 4);
}
