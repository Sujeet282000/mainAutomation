import { completeAi, redactPii, screenOutput } from "./ai-runtime";
import { randomUUID } from "node:crypto";
import { query, queryOne } from "./db";
import { recordUsage } from "./metering";
import { invokeTool } from "./tool-registry";

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

export function assertToolAllowed(tool: AgentTool, allowlist: AgentTool[]) {
  if (!allowlist.length) {
    throw new Error("This agent has no allowed tools. Add an explicit allow-list before it can act.");
  }
  const ok = allowlist.some((t) => t.appSlug === tool.appSlug && t.operation === tool.operation);
  if (!ok) throw new Error(`Blocked: ${toolKey(tool)} is not on this agent's allow-list.`);
}

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

export async function runAgentLoop(opts: {
  agent: {
    id: string;
    instructions: string;
    knowledge: string;
    tools: unknown;
    approval_required?: boolean;
    max_actions?: number;
    status: string;
  };
  message: string;
  workspaceId: string;
  organizationId: string;
}) {
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
  const traces: Array<Record<string, unknown>> = [];
  let reply = "";
  let status: "ok" | "awaiting_approval" | "blocked" | "budget_exhausted" = "ok";
  const max = Math.min(Math.max(opts.agent.max_actions ?? 8, 1), 12);

  for (let i = 0; i < max; i++) {
    const planned = await completeAi({
      intent: "reason",
      json: true,
      piiFilter: pii,
      system:
        'You are an automation agent. Return JSON only: {"type":"reply","text":"..."} or {"type":"tool","tool":{"appSlug":"","operation":""},"input":{}}. Use only allowlisted tools.',
      prompt: JSON.stringify({
        goal: opts.agent.instructions,
        knowledge: opts.agent.knowledge,
        observation,
        allowlist: allow.map(toolKey),
        prior: traces
      })
    });
    const step = parseAgentPlan(planned.text || `{"type":"reply","text":"Noted: ${observation}"}`);
    if (step.type === "reply" || !step.tool?.appSlug) {
      reply = step.text || "Done.";
      traces.push({ type: "reply", text: reply });
      break;
    }
    if (!allow.length) {
      reply = step.text || "I can answer from instructions and knowledge only; no tools are allowed on this agent.";
      traces.push({ type: "reply", text: reply, skippedTool: toolKey(step.tool) });
      break;
    }
    assertToolAllowed(step.tool, allow);
    const bound = allow.find((t) => t.appSlug === step.tool!.appSlug && t.operation === step.tool!.operation);
    const connectionId = bound?.connectionId ?? null;
    if (opts.agent.approval_required) {
      const pending = await queryOne(
        `insert into agent_approvals (organization_id, workspace_id, agent_id, app_slug, operation, input, status)
         values ($1,$2,$3,$4,$5,$6,'pending') returning *`,
        [
          opts.organizationId,
          opts.workspaceId,
          opts.agent.id,
          step.tool.appSlug,
          step.tool.operation,
          JSON.stringify(step.input ?? {})
        ]
      );
      traces.push({ type: "approval", tool: toolKey(step.tool), pending });
      reply = `Paused for approval before ${toolKey(step.tool)}.`;
      status = "awaiting_approval";
      break;
    }
    const result = await invokeTool({
      piece: step.tool.appSlug,
      operation: step.tool.operation,
      connectionId,
      props: step.input ?? {},
      workspaceId: opts.workspaceId,
      organizationId: opts.organizationId,
      executionId: `agent:${runId}`,
      // A new human message is a new agent run. Reusing a key across messages
      // can incorrectly suppress a legitimate later action.
      idempotencyKey: `agent:${runId}:${i}:${step.tool.appSlug}:${step.tool.operation}`,
      allowDestructive: false,
      source: "agent"
    });
    const screened = screenOutput(JSON.stringify(result.output ?? {}));
    if (!screened.allowed) {
      traces.push({ type: "blocked", tool: toolKey(step.tool), reason: screened.reason });
      reply = "A tool result was blocked by AI guardrails.";
      status = "blocked";
      break;
    }
    traces.push({ type: "tool", tool: toolKey(step.tool), output: result.output });
    reply = `Ran ${toolKey(step.tool)}.`;
  }

  if (!reply) {
    reply = `Stopped after the ${max}-action limit. Review the reasoning trace before continuing.`;
    status = "budget_exhausted";
    traces.push({ type: "budget", maxActions: max });
  }

  const activity = await queryOne(
    `insert into agent_activities (agent_id, workspace_id, organization_id, type, input, output, cost, status)
     values ($1,$2,$3,'run',$4,$5,1,$6) returning *`,
    [
      opts.agent.id,
      opts.workspaceId,
      opts.organizationId,
      JSON.stringify({ runId, message: observation }),
      JSON.stringify({ reply, traces }),
      status
    ]
  );
  await recordUsage({
    organizationId: opts.organizationId,
    workspaceId: opts.workspaceId,
    metric: "agent_activities",
    quantity: 1,
    metadata: { agentId: opts.agent.id }
  });
  return { reply, traces, activity };
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
    `insert into agent_activities (agent_id, workspace_id, organization_id, type, input, output, cost, status)
     values ($1,$2,$3,'approval',$4,$5,1,'ok')`,
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
