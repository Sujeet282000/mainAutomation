import { randomUUID } from "node:crypto";
import { AgentRuntime, type AgentChatModel, type AgentRunEvent } from "@algoverge/ai-agent";
import { AgentToolRegistry } from "@algoverge/ai-agent";
import { screenOutput, redactPii } from "./ai-runtime";
import { env } from "./config";
import { query, queryOne } from "./db";
import { recordUsage } from "./metering";
import { invokeTool } from "./tool-registry";
import { pieceRegistry } from "./pieces/registry";
import { chatWithTools, parseModelRoute, type ChatMessage, type ToolSchema } from "./agent/model-router";

export type AgentTool = { appSlug: string; operation: string; connectionId?: string | null };

export function parseTools(raw: unknown): AgentTool[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") {
        const [appSlug, operation] = item.split(":");
        return appSlug && operation ? { appSlug, operation } : null;
      }
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const appSlug = String(rec.appSlug ?? rec.app_slug ?? "");
        const operation = String(rec.operation ?? rec.event ?? "");
        if (!appSlug || !operation) return null;
        return {
          appSlug,
          operation,
          connectionId:
            typeof rec.connectionId === "string"
              ? rec.connectionId
              : typeof rec.connection_id === "string"
                ? rec.connection_id
                : null
        };
      }
      return null;
    })
    .filter((t): t is AgentTool => Boolean(t));
}

export function toolKey(tool: AgentTool) {
  return `${tool.appSlug}:${tool.operation}`;
}

/**
 * Legacy JSON plan parser, still used as a fallback for models without native
 * tool-calling. Accepts {"type":"reply","text":"..."} or
 * {"type":"tool","tool":{"appSlug":"","operation":""},"input":{}}.
 */
export function parseAgentPlan(
  raw: string
): { type: "reply" | "tool"; text?: string; tool?: AgentTool; input?: Record<string, unknown> } {
  const trimmed = raw.trim();
  try {
    const jsonStart = trimmed.indexOf("{");
    const parsed = JSON.parse(jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed) as Record<string, unknown>;
    if (parsed.type === "tool" || (parsed.tool && typeof parsed.tool === "object")) {
      const toolRaw = (parsed.tool as Record<string, unknown> | undefined) ?? parsed;
      const appSlug = String(toolRaw.appSlug ?? "");
      const operation = String(toolRaw.operation ?? "");
      if (appSlug && operation) {
        return {
          type: "tool",
          tool: { appSlug, operation },
          input: (parsed.input as Record<string, unknown> | undefined) ?? {}
        };
      }
    }
    return { type: "reply", text: String(parsed.text ?? parsed.reply ?? trimmed) };
  } catch {
    return { type: "reply", text: trimmed || "I logged this observation." };
  }
}

export function assertToolAllowed(tool: AgentTool, allowlist: AgentTool[]) {
  if (!allowlist.length) {
    throw new Error("This agent has no allowed tools. Add an explicit allow-list before it can act.");
  }
  const ok = allowlist.some((t) => t.appSlug === tool.appSlug && t.operation === tool.operation);
  if (!ok) throw new Error(`Blocked: ${toolKey(tool)} is not on this agent's allow-list.`);
}

/** Parse `provider:model` agent config like `openai:gpt-4o-mini`. */
function parseAgentModel(model: unknown) {
  const raw = String(model ?? "auto").trim();
  return parseModelRoute(raw);
}

/**
 * Build the runtime tool registry for one agent run.
 * Piece tools are exposed as `piece__operation` and validated against the
 * mandatory allow-list before registration — an agent can never call a tool
 * that is not on its allow-list, even if the model hallucinates the name.
 */
function buildAgentToolRegistry(opts: {
  allow: AgentTool[];
  workspaceId: string;
  organizationId: string;
  executionId: string;
}): { registry: AgentToolRegistry; risk: Map<string, "read" | "write" | "destructive"> } {
  const registry = new AgentToolRegistry();
  const risk = new Map<string, "read" | "write" | "destructive">();

  for (const tool of opts.allow) {
    const name = `${tool.appSlug}__${tool.operation}`;
    let card: { description: string; sideEffect?: string; allProps: Record<string, { type: string; hint?: string; required: boolean }> };
    try {
      const action = pieceRegistry.getAction(tool.appSlug, tool.operation);
      card = {
        description: action.description || `${tool.appSlug} ${tool.operation}`,
        sideEffect: action.sideEffect,
        allProps: Object.fromEntries(
          Object.entries(action.props ?? {}).map(([k, v]) => [k, { type: v.kind, hint: v.aiHint, required: Boolean(v.required) }]),
        ),
      };
      risk.set(name, action.sideEffect === "delete" ? "destructive" : action.sideEffect ? "write" : "read");
    } catch {
      card = { description: `${tool.appSlug} ${tool.operation}`, allProps: {} };
      risk.set(name, "write");
    }
    const description = card.description;
    const allProps = card.allProps;
    const sideEffect = card.sideEffect;
    registry.register({
      name,
      description,
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(allProps).map(([k, v]) => [k, { type: v.type === "text" ? "string" : v.type === "number" ? "number" : "string", description: v.hint }]),
        ),
        additionalProperties: true,
      },
      execute: async (_ctx, input) => {
        try {
          const result = await invokeTool({
            piece: tool.appSlug,
            operation: tool.operation,
            connectionId: tool.connectionId ?? null,
            props: input,
            workspaceId: opts.workspaceId,
            organizationId: opts.organizationId,
            executionId: opts.executionId,
            idempotencyKey: `agent:${opts.executionId}:${tool.appSlug}:${tool.operation}`,
            allowDestructive: false,
            source: "agent",
          });
          return { callId: "", ok: true, data: sanitizeToolOutput(result.output) };
        } catch (error) {
          return {
            callId: "",
            ok: false,
            error: { code: "TOOL_FAILED", message: error instanceof Error ? error.message : "tool failed" },
          };
        }
      },
    });
    void sideEffect;
  }
  return { registry, risk };
}

/** Never hand raw provider payloads (which may embed secrets) back to the model. */
function sanitizeToolOutput(output: unknown): unknown {
  const text = JSON.stringify(output ?? {});
  const screened = screenOutput(text);
  return screened.allowed ? output : { blocked: screened.reason };
}

export interface AgentLoopResult {
  reply: string;
  traces: Array<Record<string, unknown>>;
  status: "ok" | "awaiting_approval" | "blocked" | "budget_exhausted" | "failed" | "cancelled";
  runId: string;
  rounds: number;
  usage: { inputTokens: number; outputTokens: number };
  activity: Record<string, unknown> | null;
}

export async function runAgentLoop(opts: {
  agent: {
    id: string;
    instructions: string;
    knowledge: string;
    tools: unknown;
    model?: string | null;
    approval_required?: boolean;
    max_actions?: number;
    status: string;
  };
  message: string;
  workspaceId: string;
  organizationId: string;
  userId?: string;
  /** Skip the activity insert when the caller persists its own record. */
  persistActivity?: boolean;
}): Promise<AgentLoopResult> {
  if (opts.agent.status === "off") throw new Error("agent_off");
  const allow = parseTools(opts.agent.tools);
  const settings = await queryOne<{ agents_enabled: boolean; pii_filter: boolean; monthly_activity_cap: number }>(
    `select agents_enabled, pii_filter, monthly_activity_cap from workspace_ai_settings where workspace_id=$1`,
    [opts.workspaceId]
  ).catch(() => null);
  if (settings && settings.agents_enabled === false) throw new Error("agents_disabled");

  const monthCount = await queryOne<{ n: string }>(
    `select count(*)::text as n from agent_activities
     where workspace_id=$1 and created_at >= date_trunc('month', now())`,
    [opts.workspaceId]
  );
  const cap = settings?.monthly_activity_cap ?? 400;
  if (Number(monthCount?.n ?? 0) >= cap) throw new Error("agent_activity_cap");

  const pii = settings?.pii_filter !== false;
  const observation = pii ? redactPii(opts.message) : opts.message;
  const runId = randomUUID();

  // ── Durable run record ──
  await query(
    `insert into agent_runs (id, agent_id, org_id, workspace_id, status, input_message)
     values ($1,$2,$3,$4,'running',$5)`,
    [runId, opts.agent.id, opts.organizationId, opts.workspaceId, observation]
  );

  const { registry } = buildAgentToolRegistry({
    allow,
    workspaceId: opts.workspaceId,
    organizationId: opts.organizationId,
    executionId: `agent:${runId}`,
  });

  // Approval path: when approval is required we do not hand tools to the
  // model at all. The model sees a read-only "propose_tool" tool whose calls
  // are persisted as pending approvals instead of being executed.
  let approvalPayload: { appSlug: string; operation: string; input: Record<string, unknown>; approvalId: string } | null = null;
  if (opts.agent.approval_required && allow.length) {
    const first = allow[0];
    registry.register({
      name: "request_tool_approval",
      description:
        `Request human approval to run ${toolKey(first)}. Provide the full input arguments. ` +
        "The run pauses until a workspace admin approves or rejects it.",
      inputSchema: {
        type: "object",
        properties: {
          input: { type: "object", description: `Arguments for ${toolKey(first)}` },
          reason: { type: "string", description: "Why this action is needed" },
        },
        required: ["input"],
        additionalProperties: true,
      },
      execute: async (_ctx, input) => {
        const approvalInput = (input.input as Record<string, unknown>) ?? input;
        const row = await queryOne(
          `insert into agent_approvals (org_id, organization_id, workspace_id, agent_id, app_slug, operation, input, status)
           values ($1,$1,$2,$3,$4,$5,$6,'pending') returning *`,
          [
            opts.organizationId,
            opts.workspaceId,
            opts.agent.id,
            first.appSlug,
            first.operation,
            JSON.stringify(approvalInput),
          ]
        );
        approvalPayload = {
          appSlug: first.appSlug,
          operation: first.operation,
          input: approvalInput,
          approvalId: String(row?.id ?? ""),
        };
        return { callId: "", ok: true, data: { approvalId: row?.id, status: "pending" } };
      },
    });
  }

  // ── Model adapter bridging the runtime contract to the provider router ──
  const route = parseAgentModel(opts.agent.model);
  const model: AgentChatModel = {
    async request({ messages, tools, signal }) {
      const chat: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
        toolCallId: m.toolCallId,
        name: m.name,
        toolCalls: m.toolCalls?.map((c) => ({
          id: c.callId,
          name: c.name,
          arguments: c.arguments,
          thoughtSignature: c.thoughtSignature,
        })),
      }));
      const schemas: ToolSchema[] = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
      const completion = await chatWithTools({ route, messages: chat, tools: schemas });
      if (signal?.aborted) throw new Error("aborted");
      return {
        message: completion.text,
        toolCalls: completion.toolCalls.map((c) => ({
          callId: c.id,
          name: c.name,
          arguments: c.arguments,
          thoughtSignature: c.thoughtSignature,
        })),
        usage: completion.usage,
        model: completion.model,
        finishReason: completion.finishReason,
      };
    },
  };

  const traces: Array<Record<string, unknown>> = [];
  // CPU-inference backends (Ollama etc.) can spend minutes on a cold model load
  // plus a single completion; scale the wall-clock budget so local providers get
  // a fair shot instead of tripping the time budget mid-round.
  const isLocalRoute = route.kind === "fixed" && route.provider === "local";
  const timeBudgetMs = isLocalRoute ? 600_000 : 90_000;
  const runtime = new AgentRuntime(
    model,
    registry,
    undefined,
    { maxRounds: 12, maxToolCalls: Math.min(Math.max(opts.agent.max_actions ?? 8, 1), 24), timeBudgetMs }
  );

  // Durable event trail: every round/model/tool event is persisted so runs are
  // auditable and resumable later. Buffered and flushed every few events.
  let eventBuffer: Array<{ seq: number; type: string; at: string; data: Record<string, unknown> }> = [];
  const flushEvents = async (final = false) => {
    if (!eventBuffer.length) return;
    const batch = eventBuffer;
    eventBuffer = [];
    const values = batch
      .map((_e, i) => `($1,$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4},$${i * 4 + 5})`)
      .join(",");
    const params: unknown[] = [runId];
    for (const e of batch) {
      params.push(e.seq, e.type, e.at, JSON.stringify(e.data));
    }
    try {
      await query(
        `insert into agent_run_events (run_id, seq, type, at, data) values ${values} on conflict do nothing`,
        params
      );
    } catch {
      /* event persistence is best-effort; never fail the run over it */
    }
    void final;
  };

  let result;
  try {
    result = await runtime.run(
      { workspaceId: opts.workspaceId, userId: opts.userId ?? opts.organizationId },
      observation,
      {
        runId,
        instructions: [opts.agent.instructions, opts.agent.knowledge].filter(Boolean).join("\n\nKnowledge:\n"),
        signal: undefined,
        hooks: {
          onEvent: (event: AgentRunEvent) => {
            traces.push(eventToTrace(event));
            eventBuffer.push({ seq: event.seq, type: event.type, at: event.at, data: event.data });
            if (eventBuffer.length >= 8) void flushEvents();
          },
        },
      }
    );
    await flushEvents(true);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "agent run failed";
    await query(`update agent_runs set status='failed', error=$2, updated_at=now() where id=$1`, [runId, messageText]);
    await query(
      `insert into agent_activities (agent_id, org_id, workspace_id, organization_id, type, input, output, cost, status)
       values ($1,$2,$3,$2,'run',$4,$5,1,'failed')`,
      [opts.agent.id, opts.workspaceId, opts.organizationId, JSON.stringify({ runId, message: observation }), JSON.stringify({ error: messageText })]
    );
    throw error;
  }

  // ── Approval pause ──
  if (approvalPayload) {
    await query(`update agent_runs set status='awaiting_approval', reply=$2, updated_at=now() where id=$1`, [
      runId,
      result.message,
    ]);
    const reply = result.message
      ? `${result.message}\n\nPaused for approval before ${toolKey(approvalPayload)}. Approve it from the agent's approvals panel.`
      : `Paused for approval before ${toolKey(approvalPayload)}.`;
    await persistActivity({ reply, status: "awaiting_approval" });
    return {
      reply,
      traces,
      status: "awaiting_approval",
      runId,
      rounds: result.rounds,
      usage: result.usage,
      activity: null,
    };
  }

  // Guardrail screening of the final message.
  const screened = screenOutput(result.message);
  let reply = screened.allowed && result.message ? result.message : "The agent reply was blocked by AI guardrails.";
  if (!result.message && (result.status === "failed" || result.status === "cancelled")) {
    reply = friendlyRunFailure(result.stopReason);
  }
  let status: AgentLoopResult["status"] =
    result.status === "completed"
      ? "ok"
      : result.status === "budget_exhausted"
        ? "budget_exhausted"
        : result.status === "cancelled"
          ? "cancelled"
          : result.status === "failed"
            ? "failed"
            : "blocked";

  await query(
    `update agent_runs set status=$2, reply=$3, rounds=$4, stop_reason=$5, model=$6, usage=$7, updated_at=now() where id=$1`,
    [runId, result.status, reply, result.rounds, result.stopReason, "", JSON.stringify(result.usage)]
  );
  await persistActivity({ reply, status });

  return { reply, traces, status, runId, rounds: result.rounds, usage: result.usage, activity: null };

  async function persistActivity(p: { reply: string; status: string }) {
    await query(
      `insert into agent_activities (agent_id, org_id, workspace_id, organization_id, type, input, output, cost, status)
       values ($1,$2,$3,$2,'run',$4,$5,1,$6)`,
      [
        opts.agent.id,
        opts.workspaceId,
        opts.organizationId,
        JSON.stringify({ runId, message: observation }),
        JSON.stringify({ reply: p.reply, traces }),
        p.status
      ]
    );
    await recordUsage({
      organizationId: opts.organizationId,
      workspaceId: opts.workspaceId,
      metric: "agent_activities",
      quantity: 1,
      metadata: { agentId: opts.agent.id }
    });
  }
}

function eventToTrace(event: AgentRunEvent): Record<string, unknown> {
  return { type: event.type, seq: event.seq, at: event.at, ...event.data };
}

/** Turn raw stop reasons into actionable user-facing messages. */
function friendlyRunFailure(stopReason: string): string {
  if (stopReason.startsWith("model_error:MODEL_PROVIDER_FAILED")) {
    return "No model provider responded. All configured providers failed — check API keys and billing credits (OpenAI/Anthropic), or start a local LLM at LOCAL_LLM_BASE_URL. Details are in the run trace.";
  }
  if (stopReason.startsWith("model_error:NO_MODEL_PROVIDER")) {
    return "No model provider is configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY or LOCAL_LLM_BASE_URL.";
  }
  if (stopReason.startsWith("model_error:")) {
    return `The model call failed: ${stopReason.slice("model_error:".length, 240)}`;
  }
  if (stopReason === "cancelled_before_round" || stopReason === "cancelled_mid_round") {
    return "The run was cancelled before completion.";
  }
  return `The run ended early (${stopReason}).`;
}

export async function decideAgentApproval(opts: {
  approvalId: string;
  workspaceId: string;
  organizationId: string;
  userId: string;
  decision: "approved" | "rejected";
}) {
  const row = await queryOne<{
    id: string;
    agent_id: string;
    app_slug: string;
    operation: string;
    input: Record<string, unknown>;
    status: string;
  }>(
    `select * from agent_approvals where id=$1 and workspace_id=$2 and status='pending'`,
    [opts.approvalId, opts.workspaceId]
  );
  if (!row) return null;
  await query(
    `update agent_approvals set status=$2, decided_by=$3, decided_at=now() where id=$1`,
    [row.id, opts.decision, opts.userId]
  );
  if (opts.decision === "rejected") {
    return { approval: { ...row, status: "rejected" }, output: null };
  }
  const agent = await queryOne<{ tools: unknown }>(`select tools from agents where id=$1 and workspace_id=$2`, [
    row.agent_id,
    opts.workspaceId
  ]);
  const allow = parseTools(agent?.tools);
  assertToolAllowed({ appSlug: row.app_slug, operation: row.operation }, allow);
  const bound = allow.find((t) => t.appSlug === row.app_slug && t.operation === row.operation);
  const result = await invokeTool({
    piece: row.app_slug,
    operation: row.operation,
    connectionId: bound?.connectionId,
    props: row.input ?? {},
    workspaceId: opts.workspaceId,
    organizationId: opts.organizationId,
    executionId: `agent-approval:${row.id}`,
    idempotencyKey: `agent-approval:${row.id}`,
    allowDestructive: true,
    source: "agent"
  });
  await query(
    `insert into agent_activities (agent_id, org_id, workspace_id, organization_id, type, input, output, cost, status)
     values ($1,$2,$3,$2,'approval',$4,$5,1,'ok')`,
    [
      row.agent_id,
      opts.workspaceId,
      opts.organizationId,
      JSON.stringify({ approvalId: row.id, appSlug: row.app_slug, operation: row.operation }),
      JSON.stringify(result.output)
    ]
  );
  await recordUsage({
    organizationId: opts.organizationId,
    workspaceId: opts.workspaceId,
    metric: "agent_activities",
    quantity: 1,
    metadata: { agentId: row.agent_id, approvalId: row.id }
  });
  return { approval: { ...row, status: "approved" }, output: result.output };
}

/** Exposed for tests and the /ai/model-options surface: availability snapshot. */
export function modelAvailability() {
  return {
    openai: Boolean(env.openai),
    anthropic: Boolean(env.anthropic),
    gemini: Boolean(env.gemini),
    groq: Boolean(env.groq),
    local: Boolean(env.localLlmUrl),
  };
}
