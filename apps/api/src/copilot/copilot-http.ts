import type { Request, Response } from "express";
import { coerceWorkflowGraph } from "@algoverge/core";
import type { AutomationPlan } from "@algoverge/shared";
import { query, queryOne } from "../db";
import { persistBuilderDraft, loadBuilderGraph } from "../flow-runtime";
import { copilotChat } from "./copilot";
import { runCopilotEngine } from "./copilot-engine";
import { runEnhancedCopilot, buildPlanAtomically } from "./copilot-plan-builder";
import { parseCopilotMode } from "./copilot-pipeline";
import { probeAiService, signedAiJson, streamAiCopilotGenerate } from "../ai-service";
import { listCatalogApps } from "../catalog/catalog";
import { applyAgentOperations, type AgentOperation } from "../agent-operation-applier";

const STAGE_FOR_DB: Record<string, string> = { connect: "connections", schema: "schemas", map: "mapping" };
const PERSISTABLE_EVENTS = new Set(["stage", "reasoning", "proposal", "applied", "todo", "usage", "done", "error"]);
const PERSISTABLE_STAGES = new Set(["intent", "plan", "retrieve", "select", "connections", "schemas", "mapping", "assemble", "validate", "repair", "persist"]);

/** Apps whose steps work without a stored connection. */
const NO_AUTH_APPS = new Set(["webhook", "http", "manual", "schedule", "delay", "filter", "code"]);

/**
 * Emit an operation card that mirrors the proposed canvas: one row per node
 * with honest per-step status (configured / needs setup / needs connection),
 * plus the edge count so users can see the steps are wired together.
 *
 * Also emits per-step richer events the builder UI consumes directly:
 *  - `connection_required` → connection card with a real "Connect" action
 *  - `step_completed`      → per-step done/error activity + first unconfigured step pointer
 */
async function sendOperationCard(
  send: (event: Record<string, unknown>) => Promise<void>,
  resultGraph: { nodes: Array<{ id: string; label?: string; appSlug?: string; operation?: string; connectionId?: string | null; config?: Record<string, unknown> }>; edges: Array<{ id: string }> },
  title: string,
) {
  const steps = resultGraph.nodes.map((n) => {
    const appLabel = n.label || n.appSlug || n.id;
    let status: "completed" | "pending" = "completed";
    let detail: string | undefined;
    if (!n.appSlug || !n.operation) {
      status = "pending";
      detail = "needs setup";
    } else if (!n.connectionId && !NO_AUTH_APPS.has(n.appSlug)) {
      status = "pending";
      detail = "connect account";
    }
    return { label: appLabel, status, detail };
  });
  const pending = steps.filter((s) => s.status === "pending").length;
  await send({
    type: "operation_card",
    operation: {
      title,
      steps,
      status: "completed" as const,
      detail: `${steps.length} step${steps.length === 1 ? "" : "s"} \u00b7 ${resultGraph.edges.length} connection${resultGraph.edges.length === 1 ? "" : "s"}${pending > 0 ? ` \u00b7 ${pending} need${pending === 1 ? "s" : ""} setup` : ""}`,
      actions: [
        { label: "Test workflow", prompt: "Test this workflow" },
        { label: "Add a step", prompt: "Add the next step" },
      ],
    },
  });

  // Per-step events the builder UI turns into connection cards and activity.
  for (const n of resultGraph.nodes) {
    const appName = n.label || n.appSlug || "App";
    if (n.appSlug && !n.connectionId && !NO_AUTH_APPS.has(n.appSlug)) {
      await send({
        type: "connection_required",
        stepId: n.id,
        appSlug: n.appSlug,
        appName,
        message: "Connect your account so this step can run",
        actions: [{ type: "connect_account", label: `Connect ${appName}`, appSlug: n.appSlug, stepId: n.id }],
      });
    } else if (n.appSlug && n.operation) {
      // Only configured steps emit completion — blank steps are already shown
      // as "needs setup" in the operation card and must not render as errors.
      await send({ type: "step_completed", stepId: n.id, label: appName, success: true, detail: n.connectionId ? undefined : "no account needed" });
    }
  }
}

// ── Conversation history helpers ───────────────────────────────────────
export type ChatTurn = { role: "user" | "assistant"; content: string; ts: string };
const MAX_HISTORY_TURNS = 24;

export async function loadChatHistory(sessionId: string, orgId: string): Promise<ChatTurn[]> {
  const row = await queryOne<{ chat_history: ChatTurn[] | null }>(
    `SELECT chat_history FROM copilot_sessions WHERE id = $1 AND org_id = $2`,
    [sessionId, orgId],
  );
  const raw = row?.chat_history;
  if (!Array.isArray(raw)) return [];
  return raw.slice(-MAX_HISTORY_TURNS);
}

export async function appendChatTurn(
  sessionId: string, orgId: string, turn: ChatTurn,
): Promise<void> {
  // Append the turn and keep only the last MAX_HISTORY_TURNS entries.
  // We use jsonb_array_append for atomicity, then trim in a second pass
  // only when the array exceeds the limit.
  await query(
    `UPDATE copilot_sessions
       SET chat_history = (
         SELECT jsonb_agg(el)
         FROM (
           SELECT jsonb_array_elements(
             chat_history || $3::jsonb
           ) AS el
           LIMIT $4
         ) sub
       ),
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [sessionId, orgId, JSON.stringify([turn]), MAX_HISTORY_TURNS],
  ).catch(() => undefined);
}

export async function ensureProjectId(orgId: string) {
  const existing = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE org_id = $1 ORDER BY created_at ASC LIMIT 1`, [orgId]);
  if (existing) return existing.id;
  const created = await queryOne<{ id: string }>(`INSERT INTO projects (org_id, name, slug) VALUES ($1, 'Main', 'main') RETURNING id`, [orgId]);
  return created!.id;
}

async function logCopilotEvent(orgId: string, sessionId: string, sequenceNo: number, event: Record<string, unknown>) {
  const type = String(event.type ?? "");
  if (!PERSISTABLE_EVENTS.has(type)) return;
  const rawStage = event.stage ? String(event.stage) : undefined;
  const stage = rawStage ? (STAGE_FOR_DB[rawStage] ?? rawStage) : null;
  if (stage && !PERSISTABLE_STAGES.has(stage)) return;
  await query(`INSERT INTO copilot_events (org_id, session_id, sequence_no, event_type, stage, payload) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (session_id, sequence_no) DO NOTHING`, [orgId, sessionId, sequenceNo, type, stage, JSON.stringify(event)]).catch(() => undefined);
}

async function groundGraph(graph: unknown, operations: unknown[], opts: { workspaceId: string; organizationId: string; allowDestructive: boolean }) {
  return applyAgentOperations({ graph, operations, workspaceId: opts.workspaceId, organizationId: opts.organizationId, allowDestructive: opts.allowDestructive });
}

/** Emit field_mapping events for config values that reference earlier steps' outputs. */
async function sendFieldMappings(
  send: (event: Record<string, unknown>) => Promise<void>,
  resultGraph: { nodes: Array<{ id: string; label?: string; appSlug?: string; type?: string; config?: Record<string, unknown> }> },
) {
  for (const node of resultGraph.nodes) {
    const config = node.config ?? {};
    const mapped = Object.entries(config).filter(([, v]) => typeof v === "string" && /\{\{|steps\.|trigger\./i.test(String(v)));
    if (mapped.length === 0) continue;
    const sourceNode = resultGraph.nodes.find((n) => n.type === "trigger") ?? resultGraph.nodes[0];
    await send({
      type: "field_mapping",
      stepId: node.id,
      sourceLabel: sourceNode?.label || sourceNode?.appSlug || "Previous steps",
      targetLabel: node.label || node.appSlug || "Step",
      mappings: mapped.map(([field, value]) => ({ source: String(value), target: field })),
    });
  }
}

async function persistGroundedGraph(sessionId: string, graph: unknown, pendingOps?: unknown[]) {
  const coerced = coerceWorkflowGraph(graph);
  const definition = persistBuilderDraft(coerced);
  if (pendingOps && pendingOps.length > 0) {
    await query(
      `UPDATE copilot_sessions SET proposed_definition = $1, pending_operations = $2, stage = 'persist', updated_at = now() WHERE id = $3`,
      [JSON.stringify(definition), JSON.stringify(pendingOps), sessionId],
    );
  } else {
    await query(
      `UPDATE copilot_sessions SET proposed_definition = $1, stage = 'persist', updated_at = now() WHERE id = $2`,
      [JSON.stringify(definition), sessionId],
    );
  }
  return { graph: coerced, definition };
}

export async function streamCopilotSession(opts: { req: Request; res: Response; sessionId: string; orgId: string; prompt: string; mode?: unknown; graph?: unknown; flowId?: string; projectId?: string }) {
  const mode = parseCopilotMode(opts.mode);
  let graph;
  try { graph = opts.graph ? coerceWorkflowGraph(opts.graph) : undefined; } catch { graph = undefined; }
  let seq = 0;
  const send = async (event: Record<string, unknown>) => { opts.res.write(`data: ${JSON.stringify(event)}\n\n`); seq += 1; await logCopilotEvent(opts.orgId, opts.sessionId, seq, event); };

  const ai = await probeAiService();
  if (ai.reachable) {
    try {
      await send({ type: "agent_started" });
      await send({ type: "agent_state", state: "inspecting", title: "Inspecting workflow" });
      await send({ type: "agent_activity", kind: "running", label: "Reading your request" });
      await send({ type: "reasoning", text: ai.hint, stage: "intent" });
      let sawResult = false;
      let lastGrounded: { issues?: Array<{ code?: string }>; rejected?: unknown[]; needsConfirmation?: unknown[] } | null = null;
      for await (const ev of streamAiCopilotGenerate({ sessionId: opts.sessionId, flowId: opts.flowId || opts.sessionId, prompt: opts.prompt, orgId: opts.orgId, userEmail: opts.req.user?.email ?? "", projectId: opts.projectId || opts.orgId, autonomy: mode })) {
        if ((ev.type === "result" || ev.type === "proposal") && ev.graph) {
          const operations = Array.isArray(ev.operations) ? ev.operations : [];
          const rawGraph = operations.length ? graph : ev.graph;
          try {
            const grounded = operations.length
              ? await groundGraph(rawGraph ?? ev.graph, operations as AgentOperation[], { workspaceId: opts.orgId, organizationId: opts.orgId, allowDestructive: false })
              : { graph: coerceWorkflowGraph(ev.graph), applied: [], rejected: [], needsConfirmation: [], issues: [], testResults: [] };
            const needsApproval = grounded.needsConfirmation.length > 0 || grounded.rejected.length > 0;
            const persisted = await persistGroundedGraph(
              opts.sessionId,
              grounded.graph,
              needsApproval ? operations : undefined,
            );
            sawResult = true;
            lastGrounded = grounded;
            await send({ ...ev, graph: persisted.graph, definition: persisted.definition, sessionId: opts.sessionId, operations, applied_operations: grounded.applied, rejected_operations: grounded.rejected, needs_confirmation: grounded.needsConfirmation, issues: grounded.issues, applied: mode === "auto_build" && !needsApproval, mode, source: "python-copilot" });
            continue;
          } catch (error) {
            await send({ type: "error", stage: "validate", message: error instanceof Error ? error.message : "AI proposal could not be grounded" });
            continue;
          }
        }
        await send({ ...ev, stage: STAGE_FOR_DB[String(ev.stage ?? "")] ?? ev.stage, label: ev.label ?? ev.stage });
      }
      if (sawResult) {
        // Honest publishable flag: only claim publishable when the last grounded
        // result had no blocking issues and nothing is waiting on the user.
        const blocking = lastGrounded?.issues?.length || lastGrounded?.rejected?.length || lastGrounded?.needsConfirmation?.length;
        await send({ type: "done", status: blocking ? "needs_attention" : "draft_ready", publishable: !blocking, note: blocking ? "Some steps need setup (connection/configuration) before this can publish." : "Review and publish. Confirmation-gated operations must be explicitly approved.", source: "python-copilot" });
        return;
      }
    } catch (err) { await send({ type: "reasoning", text: `AI plane failed (${err instanceof Error ? err.message : "error"}); using the Node catalog engine.` }); }
  } else await send({ type: "reasoning", text: ai.hint });

  // ── Enhanced plan pipeline (primary Node.js path) ──
  // Produces AutomationPlan IR with connection resolution, data lineage, field mapping, and validation.
  let sawPlan = false;
  try {
    for await (const ev of runEnhancedCopilot({ prompt: opts.prompt, workspaceId: opts.orgId, userEmail: opts.req.user?.email ?? null, mode, graph })) {
      const rawEv = ev as Record<string, unknown>;
      if (ev.type === "plan") {
        // The enhanced pipeline yields a full AutomationPlan — forward it to the frontend
        await send({ type: "plan", plan: rawEv.plan, sessionId: opts.sessionId });
        sawPlan = true;
      } else if (rawEv.type === "result" && rawEv.result) {
        const result = rawEv.result as { graph: unknown; summary: string; source: string; rebuilt: boolean; changed: boolean };
        const definition = persistBuilderDraft(result.graph as any);
        await query(`UPDATE copilot_sessions SET proposed_definition = $1, stage = 'persist', updated_at = now() WHERE id = $2`, [JSON.stringify(definition), opts.sessionId]);
        await send({ type: "proposal", graph: result.graph, definition, summary: result.summary, sessionId: opts.sessionId, applied: mode === "auto_build", rebuilt: result.rebuilt, changed: result.changed, source: result.source, mode });
        await send({ type: "result", graph: result.graph, summary: result.summary, sessionId: opts.sessionId, applied: mode === "auto_build", rebuilt: result.rebuilt, changed: result.changed, source: result.source, mode });
        sawPlan = true;
      } else if (ev.type === "stage") {
        const stageLabel = ev.label ?? ev.stage ?? "Working";
        await send({ type: "stage", stage: STAGE_FOR_DB[ev.stage] ?? ev.stage, label: stageLabel });
        await send({ type: "agent_activity", kind: "done", label: String(stageLabel) });
        // Map stages to agent states
        const stateMap: Record<string, string> = { intent: "understanding", plan: "planning", retrieve: "inspecting", select: "executing", connect: "executing", schema: "inspecting", map: "executing", assemble: "executing", validate: "validating", persist: "completed" };
        const mappedState = stateMap[ev.stage];
        if (mappedState) await send({ type: "agent_state", state: mappedState, title: String(stageLabel) });
      } else {
        await send(rawEv);
      }
    }
    if (sawPlan) {
      await send({ type: "done", status: "draft_saved", publishable: true, note: "Review and publish. Copilot never publishes.", source: "copilot-plan-builder" });
      return;
    }
  } catch (enhancedErr) {
    // Enhanced pipeline failed — fall through to legacy engine
    await send({ type: "reasoning", text: `Enhanced plan pipeline failed (${enhancedErr instanceof Error ? enhancedErr.message : "error"}); using legacy engine.` });
  }

  // ── Legacy copilot engine fallback ──
  for await (const ev of runCopilotEngine({ prompt: opts.prompt, workspaceId: opts.orgId, userEmail: opts.req.user?.email, mode, graph })) {
    if (ev.type === "result") {
      const definition = persistBuilderDraft(ev.result.graph);
      await query(`UPDATE copilot_sessions SET proposed_definition = $1, stage = 'persist', updated_at = now() WHERE id = $2`, [JSON.stringify(definition), opts.sessionId]);
      await send({ type: "proposal", graph: ev.result.graph, definition, summary: ev.result.summary, sessionId: opts.sessionId, applied: mode === "auto_build", rebuilt: ev.result.rebuilt, changed: ev.result.changed, source: ev.result.source, mode });
      await send({ type: "result", graph: ev.result.graph, summary: ev.result.summary, sessionId: opts.sessionId, applied: mode === "auto_build", rebuilt: ev.result.rebuilt, changed: ev.result.changed, source: ev.result.source, mode });
    } else if (ev.type === "stage") await send({ type: "stage", stage: STAGE_FOR_DB[ev.stage] ?? ev.stage, label: ev.label });
    else await send(ev as Record<string, unknown>);
  }
  await send({ type: "done", status: "draft_saved", publishable: true, note: "Review and publish. Copilot never publishes.", source: "node-engine" });

  await send({ type: "agent_state", state: "completed", title: "Done" });
  await send({ type: "agent_activity", kind: "done", label: "Workflow ready" });
  await send({ type: "agent_completed", summary: "Workflow draft saved" });

  // Persist conversation history for multi-turn context
  const now = new Date().toISOString();
  await appendChatTurn(opts.sessionId, opts.orgId, { role: "user", content: opts.prompt, ts: now });
}

/** SSE-streaming chat endpoint: emits operation_card events in real-time
 * as the copilot processes the request, so the frontend can show live
 * step-by-step progress instead of waiting for the full response. */
export async function streamCopilotChat(opts: {
  req: Request; res: Response; sessionId: string; orgId: string;
  prompt: string; graph?: unknown; flowId?: string; mode?: unknown;
  selectedStepId?: string; projectId?: string; lastTest?: { ok?: boolean; body?: unknown; ms?: number } | null;
}) {
  const mode = parseCopilotMode(opts.mode);
  let graph;
  try { graph = opts.graph ? coerceWorkflowGraph(opts.graph) : undefined; } catch { graph = undefined; }
  let seq = 0;
  const send = async (event: Record<string, unknown>) => { opts.res.write(`data: ${JSON.stringify(event)}\n\n`); seq += 1; await logCopilotEvent(opts.orgId, opts.sessionId, seq, event); };

  // Load conversation history
  const history = await loadChatHistory(opts.sessionId, opts.orgId);

  // Emit agent state and activity events for the new UI
  await send({ type: "agent_started" });
  await send({ type: "agent_state", state: "understanding", title: "Understanding your request" });
  await send({ type: "agent_activity", kind: "running", label: "Reading your request" });

  // Probe the AI service — use the LLM agent when available, pattern matching as fallback
  let ai: Awaited<ReturnType<typeof probeAiService>>;
  try {
    ai = await probeAiService();
  } catch {
    ai = { reachable: false, mode: "down", openaiConfigured: false, anthropicConfigured: false, geminiConfigured: false, localConfigured: false, hint: "AI service probe failed" };
  }
  if (ai.reachable && graph) {
    try {
      await send({ type: "agent_state", state: "planning", title: "AI agent processing" });
      await send({ type: "agent_activity", kind: "running", label: "AI agent analyzing request" });
      // Note: ai.hint is an internal diagnostic ("AI plane is up...") — never shown to users.
      const { persistBuilderDraft } = await import("../flow-runtime");
      const { listCatalogApps } = await import("../catalog/catalog");
      const refined = await signedAiJson<{
        applied?: boolean; definition?: unknown; summary?: string;
        operations?: AgentOperation[]; needs_input?: string[];
        issues?: Array<Record<string, unknown>>; publishable?: boolean;
      }>("/copilot/refine", {
        definition: persistBuilderDraft(graph),
        instruction: opts.prompt,
        selected_step_id: opts.selectedStepId,
        catalog: listCatalogApps(),
      }, opts.orgId, 90000);
      if (refined && typeof refined.summary === "string" && /^Provider error \d+:/.test(refined.summary)) {
        // The Python gateway surfaced a raw provider error (e.g. OpenAI 429
        // "no credits"). Fail over to the Node pattern engine instead of
        // trusting it as a chat reply. No internals are broadcast — the
        // frontend simply sees the built-in engine handle it.
      } else if (refined) {
        const operations = refined.operations ?? [];
        const result = await groundGraph(graph, operations, {
          workspaceId: opts.orgId,
          organizationId: opts.orgId,
          allowDestructive: false,
        });
        const changed = JSON.stringify(result.graph) !== JSON.stringify(graph);
        const definition = persistBuilderDraft(result.graph);
        const needsApproval = result.rejected.length > 0 || result.needsConfirmation.length > 0;
        if (changed && !needsApproval) {
          await query(
            `UPDATE copilot_sessions SET proposed_definition = $1, stage = 'persist', updated_at = now() WHERE id = $2`,
            [JSON.stringify(definition), opts.sessionId],
          );
        }
        await send({ type: "agent_activity", kind: "done", label: "AI agent processed request" });
        if (result.graph?.nodes?.length) {
          await sendOperationCard(send, result.graph, changed ? "Workflow updated" : "Workflow planned");
          await sendFieldMappings(send, result.graph);
        }
        const replyText = refined.summary ?? (changed ? "I updated the workflow draft." : "I prepared a plan for the requested change.");
        await send({ type: "agent_state", state: "completed", title: "Done" });
        await send({ type: "agent_activity", kind: "done", label: "Response ready" });
        await send({ type: "chat_result", reply: replyText, graph: result.graph, sessionId: opts.sessionId, applied: !needsApproval && changed, needs_confirmation: needsApproval ? result.needsConfirmation : [], source: "python-copilot", needs_input: refined.needs_input, issues: refined.issues });
        await send({ type: "done", status: "chat_complete", source: "python-copilot" });
        const now = new Date().toISOString();
        await appendChatTurn(opts.sessionId, opts.orgId, { role: "user", content: opts.prompt, ts: now });
        await appendChatTurn(opts.sessionId, opts.orgId, { role: "assistant", content: replyText, ts: now });
        return;
      }
    } catch {
      // AI agent path unavailable — silently fall through to the Node engine.
      // (Internal failure details are never useful to end users.)
    }
  }

  // ── Agent Executor (tool-based information gathering) ──
  // Answers informational questions ("what can Gmail do?") via tools. It must
  // NEVER intercept workflow-build intents — "when X arrives, do Y" always
  // belongs to the builders so the user gets a graph, not a table of apps.
  try {
    const { generateAgentPlan, executeAgentPlan } = await import("./copilot-agent-executor");
    const { mentionsWorkflowIntent } = await import("./copilot");
    if (mentionsWorkflowIntent(opts.prompt) && !graph) throw new Error("build-intent");
    const agentCtx = { workspaceId: opts.orgId, userId: opts.req.user?.userId ?? "", flowId: opts.flowId, graph };
    const plan = await generateAgentPlan(opts.prompt, agentCtx, graph);
    if (plan && plan.calls.length > 0 && plan.confidence > 0.6) {
      await send({ type: "agent_state", state: "executing", title: "Running tool queries" });
      await send({ type: "agent_activity", kind: "running", label: `Executing ${plan.calls.length} tool query(s)` });
      const agentResult = await executeAgentPlan(plan, agentCtx);
      await send({ type: "agent_activity", kind: "done", label: "Tool queries completed" });
      const mutationResult = agentResult.results.find((item) => item.tool === "workflow.apply_operations");
      const mutationData = mutationResult?.result && typeof mutationResult.result === "object" && "data" in mutationResult.result
        ? (mutationResult.result as { data?: Record<string, unknown> }).data
        : undefined;
      if (mutationData && mutationData.graph) {
        const needsConfirmation = Array.isArray(mutationData.needs_confirmation) ? mutationData.needs_confirmation : [];
        const definition = persistBuilderDraft(mutationData.graph as any);
        if (needsConfirmation.length > 0) {
          await query(
            `UPDATE copilot_sessions
                SET proposed_definition = $1, stage = 'persist', updated_at = now()
              WHERE id = $2 AND org_id = $3`,
            [JSON.stringify(definition), opts.sessionId, opts.orgId],
          );
          await send({
            type: "proposal",
            graph: mutationData.graph,
            definition,
            operations: mutationData.operations,
            applied_operations: mutationData.applied_operations,
            rejected_operations: mutationData.rejected_operations,
            needs_confirmation: needsConfirmation,
            issues: mutationData.issues,
            sessionId: opts.sessionId,
          });
        }
        const reply = agentResult.reply || (needsConfirmation.length > 0
          ? "I prepared the workflow change. Please approve the confirmation-gated step before it runs."
          : "I updated the workflow draft.");
        await send({
          type: "agent_state",
          state: "completed",
          title: needsConfirmation.length > 0 ? "Approval needed" : "Done",
        });
        await send({
          type: "chat_result",
          reply,
          graph: mutationData.graph,
          sessionId: opts.sessionId,
          applied: needsConfirmation.length === 0 && agentResult.success,
          operations: mutationData.operations,
          applied_operations: mutationData.applied_operations,
          rejected_operations: mutationData.rejected_operations,
          needs_confirmation: needsConfirmation,
          issues: mutationData.issues,
          source: "agent-executor",
        });
        await send({ type: "done", status: needsConfirmation.length > 0 ? "approval_required" : "chat_complete", source: "agent-executor" });
        return;
      }
      // If the agent got a good response and it's NOT a workflow action, return it directly
      if (agentResult.success && agentResult.reply.length > 20) {
        await send({ type: "agent_state", state: "completed", title: "Done" });
        await send({ type: "chat_result", reply: agentResult.reply, sessionId: opts.sessionId, source: "agent-executor", suggestions: agentResult.suggestions });
        await send({ type: "done", status: "chat_complete", source: "agent-executor" });
        const now = new Date().toISOString();
        await appendChatTurn(opts.sessionId, opts.orgId, { role: "user", content: opts.prompt, ts: now });
        await appendChatTurn(opts.sessionId, opts.orgId, { role: "assistant", content: agentResult.reply, ts: now });
        return;
      }
    }
  } catch {
    /* Agent executor unavailable — fall through to copilotChat */
  }

  // ── Fallback: Node.js pattern-matching copilot (with universal handler) ──
  const { copilotChat } = await import("./copilot");
  try {
    await send({ type: "agent_state", state: "inspecting", title: "Inspecting workflow" });
    await send({ type: "agent_activity", kind: "running", label: "Inspecting workflow" });
    // Structured inspection summary — only for requests that are actually about
    // the current workflow (explain / problems / fix), never for "add a step".
    const inspectionRe = /\b(explain|what does|how does|problems?|issues?|wrong|broken|fix|review|audit|health)\b/i;
    if (graph && graph.nodes.length > 0 && inspectionRe.test(opts.prompt)) {
      const items: string[] = [];
      for (const [i, node] of graph.nodes.entries()) {
        if (!node.appSlug) items.push(`Step ${i + 1} has no app selected yet`);
        else if (!node.operation) items.push(`Step ${i + 1} (${node.label || node.appSlug}) still needs an action`);
        else if (!node.connectionId && !NO_AUTH_APPS.has(node.appSlug)) items.push(`Step ${i + 1} (${node.label || node.appSlug}) is not connected to an account`);
      }
      items.push(graph.edges.length === 1
        ? "The steps are wired together in order — the flow looks structurally sound"
        : `The steps are wired together (${graph.edges.length} connections)`);
      await send({ type: "analysis_summary", title: "What I checked", items });
    }
    const result = await copilotChat({
      prompt: opts.prompt,
      workspaceId: opts.orgId,
      organizationId: opts.orgId,
      automationId: opts.flowId ?? opts.sessionId,
      graph,
      selectedStepId: opts.selectedStepId,
      mode,
      lastTest: opts.lastTest ?? null,
      history,
    });
    await send({ type: "agent_activity", kind: "done", label: "Workflow inspected" });

    // Emit operation cards as live-updating step progress
    if (result.graph?.nodes?.length) {
      await send({ type: "agent_activity", kind: "done", label: "Workflow ready" });
      await sendOperationCard(send, result.graph, result.applied ? "Workflow updated" : "Workflow planned");
      await sendFieldMappings(send, result.graph);
    }

    // Emit agent completion and final result
    await send({ type: "agent_state", state: "completed", title: "Done" });
    await send({ type: "agent_activity", kind: "done", label: "Response ready" });
    await send({
      type: "chat_result",
      reply: result.reply,
      graph: result.graph,
      sessionId: opts.sessionId,
      applied: Boolean(result.applied),
      source: result.source,
      suggestions: result.suggestions,
      clarification: result.clarification,
      operations: result.operations,
      youDoFirst: result.youDoFirst,
      iCan: result.iCan,
      thinking: result.thinking,
    });

    // Emit done
    await send({ type: "done", status: "chat_complete", source: "copilot-chat-stream" });

    // Persist conversation turns
    const now = new Date().toISOString();
    await appendChatTurn(opts.sessionId, opts.orgId, { role: "user", content: opts.prompt, ts: now });
    await appendChatTurn(opts.sessionId, opts.orgId, { role: "assistant", content: result.reply, ts: now });
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : "Copilot error";
    // When every model provider failed, give the user an actionable message
    // instead of a raw provider error chain.
    const message = /^(NO_MODEL_PROVIDER|MODEL_PROVIDER_FAILED)/.test(rawMessage)
      ? "AI is temporarily unavailable — all model providers (OpenAI, Anthropic, Gemini, Groq, local LLM) failed. Check your API keys and billing, then try again in a moment."
      : rawMessage;
    await send({ type: "agent_state", state: "error", title: "Error" });
    await send({ type: "agent_activity", kind: "error", label: "Request failed", detail: message });
    await send({ type: "agent_error", message, recoverable: true });
    await send({ type: "error", message });
    await send({ type: "done", status: "error", source: "copilot-chat-stream" });
  }
}

export async function refineCopilotSession(opts: { sessionId: string; orgId: string; userId?: string; userEmail?: string | null; prompt: string; mode?: unknown; graph?: unknown; flowId?: string; selectedStepId?: string }) {
  const session = await queryOne<{ proposed_definition: unknown; flow_id: string | null; mode: string }>(`SELECT proposed_definition, flow_id, mode FROM copilot_sessions WHERE id = $1 AND org_id = $2`, [opts.sessionId, opts.orgId]);
  const graph = opts.graph ? coerceWorkflowGraph(opts.graph) : session?.proposed_definition ? loadBuilderGraph(session.proposed_definition) : undefined;
  const ai = await probeAiService();
  if (ai.reachable && graph) {
    const refined = await signedAiJson<{ applied?: boolean; definition?: unknown; summary?: string; operations?: AgentOperation[]; needs_input?: string[]; issues?: Array<Record<string, unknown>>; publishable?: boolean }>("/copilot/refine", { definition: persistBuilderDraft(graph), instruction: opts.prompt, selected_step_id: opts.selectedStepId, catalog: listCatalogApps() }, opts.orgId, 90000);
    const providerLeak = refined != null && typeof refined.summary === "string" && /^Provider error \d+:/.test(refined.summary);
    if (refined && !providerLeak) {
      const operations = refined.operations ?? [];
      const result = await groundGraph(graph, operations, { workspaceId: opts.orgId, organizationId: opts.orgId, allowDestructive: false });
      const changed = JSON.stringify(result.graph) !== JSON.stringify(graph);
      const definition = persistBuilderDraft(result.graph);
      const needsApproval = result.rejected.length > 0 || result.needsConfirmation.length > 0;
      if (changed && !needsApproval) {
        await query(`UPDATE copilot_sessions SET proposed_definition = $1, stage = 'persist', updated_at = now() WHERE id = $2`, [JSON.stringify(definition), opts.sessionId]);
      } else if (needsApproval && operations.length > 0) {
        await query(
          `UPDATE copilot_sessions SET proposed_definition = $1, pending_operations = $2, stage = 'persist', updated_at = now() WHERE id = $3`,
          [JSON.stringify(definition), JSON.stringify(operations), opts.sessionId],
        );
      }
      return { reply: refined.summary ?? (changed ? "I updated the workflow draft." : "I prepared a plan for the requested change."), graph: result.graph, definition, sessionId: opts.sessionId, applied: result.applied.length > 0, changed, summary: refined.summary, operations, applied_operations: result.applied, rejected_operations: result.rejected, needs_confirmation: result.needsConfirmation, needs_input: refined.needs_input ?? [], issues: [...(refined.issues ?? []), ...result.issues], test_results: result.testResults, publishable: Boolean(refined.publishable) && result.issues.length === 0 && result.rejected.length === 0 && result.needsConfirmation.length === 0, source: "python-copilot" };
    }
  }
  const history = await loadChatHistory(opts.sessionId, opts.orgId);
  const result = await copilotChat({
    prompt: opts.prompt,
    workspaceId: opts.orgId,
    organizationId: opts.orgId,
    userId: opts.userId,
    userEmail: opts.userEmail,
    automationId: opts.flowId ?? session?.flow_id ?? undefined,
    graph,
    selectedStepId: opts.selectedStepId,
    mode: parseCopilotMode(opts.mode ?? session?.mode),
    history,
  });
  if (result.graph) await query(`UPDATE copilot_sessions SET proposed_definition = $1, updated_at = now() WHERE id = $2`, [JSON.stringify(persistBuilderDraft(result.graph)), opts.sessionId]);
  // Persist both turns for multi-turn memory
  const now = new Date().toISOString();
  await appendChatTurn(opts.sessionId, opts.orgId, { role: "user", content: opts.prompt, ts: now });
  await appendChatTurn(opts.sessionId, opts.orgId, { role: "assistant", content: result.reply, ts: now });
  return result;
}
