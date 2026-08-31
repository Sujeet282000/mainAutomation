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
            await send({ ...ev, graph: persisted.graph, definition: persisted.definition, sessionId: opts.sessionId, operations, applied_operations: grounded.applied, rejected_operations: grounded.rejected, needs_confirmation: grounded.needsConfirmation, issues: grounded.issues, applied: mode === "auto_build" && !needsApproval, mode, source: "python-copilot" });
            continue;
          } catch (error) {
            await send({ type: "error", stage: "validate", message: error instanceof Error ? error.message : "AI proposal could not be grounded" });
            continue;
          }
        }
        await send({ ...ev, stage: STAGE_FOR_DB[String(ev.stage ?? "")] ?? ev.stage, label: ev.label ?? ev.stage });
      }
      if (sawResult) { await send({ type: "done", status: "draft_ready", publishable: true, note: "Review and publish. Confirmation-gated operations must be explicitly approved.", source: "python-copilot" }); return; }
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
  await send({ type: "stage", stage: "intent", label: "Understanding your request" });
  await send({ type: "agent_activity", kind: "done", label: "Understanding your request" });

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
      await send({ type: "reasoning", text: ai.hint || "Using AI agent to process your request", stage: "intent" });
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
      }, opts.orgId);
      if (refined) {
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
          const steps = result.graph.nodes.map((n: { label?: string; appSlug?: string; id: string; type?: string }) => ({
            label: `${n.label ?? n.id} (${n.appSlug ?? "unknown"})`,
            status: "completed" as const,
          }));
          await send({ type: "agent_activity", kind: "done", label: `Found ${steps.length} steps` });
          await send({ type: "operation_card", operation: { title: changed ? "Workflow updated" : "Workflow planned", steps, status: "completed" as const, actions: [{ label: "Test workflow", prompt: "Test this workflow" }, { label: "Add a step", prompt: "Add the next step" }] } });
        }
        const replyText = refined.summary ?? (changed ? "I updated the workflow draft." : "I prepared a plan for the requested change.");
        await send({ type: "agent_state", state: "completed", title: "Done" });
        await send({ type: "agent_activity", kind: "done", label: "Response ready" });
        await send({ type: "chat_result", reply: replyText, graph: result.graph, sessionId: opts.sessionId, applied: !needsApproval && changed, source: "python-copilot", needs_input: refined.needs_input, issues: refined.issues });
        await send({ type: "done", status: "chat_complete", source: "python-copilot" });
        const now = new Date().toISOString();
        await appendChatTurn(opts.sessionId, opts.orgId, { role: "user", content: opts.prompt, ts: now });
        await appendChatTurn(opts.sessionId, opts.orgId, { role: "assistant", content: replyText, ts: now });
        return;
      }
    } catch (aiErr) {
      await send({ type: "reasoning", text: `AI agent could not process this (${aiErr instanceof Error ? aiErr.message : "error"}); using pattern engine.`, stage: "intent" });
    }
  }

  // ── Agent Executor (tool-based information gathering) ──
  // When AI service isn't available, try the agent executor to gather
  // context via tools before falling back to the pattern-matching copilot.
  try {
    const { generateAgentPlan, executeAgentPlan } = await import("./copilot-agent-executor");
    const agentCtx = { workspaceId: opts.orgId, userId: opts.req.user?.userId ?? "", flowId: opts.flowId };
    const plan = await generateAgentPlan(opts.prompt, agentCtx, graph);
    if (plan && plan.calls.length > 0 && plan.confidence > 0.6) {
      await send({ type: "agent_state", state: "executing", title: "Running tool queries" });
      await send({ type: "agent_activity", kind: "running", label: `Executing ${plan.calls.length} tool query(s)` });
      const agentResult = await executeAgentPlan(plan, agentCtx);
      await send({ type: "agent_activity", kind: "done", label: "Tool queries completed" });
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
    // Emit contextual reasoning about what the copilot is doing
    const promptLower = opts.prompt.toLowerCase();
    let reasoningText = "Analyzing your request";
    if (/\b(add|insert|append)\b/.test(promptLower)) reasoningText = "Identifying the step to add and where it fits in the workflow";
    else if (/\b(explain|what|how|describe)\b/.test(promptLower)) reasoningText = "Reviewing the current workflow to provide an explanation";
    else if (/\b(test|run|check)\b/.test(promptLower)) reasoningText = "Preparing to test the workflow";
    else if (/\b(fix|repair|update|change|modify|replace)\b/.test(promptLower)) reasoningText = "Analyzing the current workflow to apply your changes";
    else if (/\b(hi|hello|hey|thanks)\b/.test(promptLower)) reasoningText = "Greeting acknowledged";
    else reasoningText = "Classifying and routing your request through the universal handler";
    await send({ type: "reasoning", text: reasoningText, stage: "intent" });
    // Emit analysis_summary with structured workflow inspection data
    if (graph && graph.nodes.length > 0) {
      const analysisItems: string[] = [];
      analysisItems.push(`Found ${graph.nodes.length} step${graph.nodes.length > 1 ? 's' : ''}`);
      for (const node of graph.nodes) {
        if (!node.appSlug) {
          analysisItems.push(`Step ${graph.nodes.indexOf(node) + 1}: No app selected`);
        } else if (!node.operation) {
          analysisItems.push(`Step ${graph.nodes.indexOf(node) + 1}: ${node.appSlug} — needs an action`);
        } else if (!node.connectionId && node.appSlug !== 'webhook' && node.appSlug !== 'http' && node.appSlug !== 'manual' && node.appSlug !== 'schedule') {
          analysisItems.push(`Step ${graph.nodes.indexOf(node) + 1}: ${node.label || node.appSlug} — needs authentication`);
        } else {
          analysisItems.push(`Step ${graph.nodes.indexOf(node) + 1}: ${node.label || node.appSlug} — configured`);
        }
      }
      await send({ type: 'analysis_summary', title: 'Workflow inspection', items: analysisItems });
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
      const steps = result.graph.nodes.map((n: { label?: string; appSlug?: string; id: string; type?: string }) => ({
        label: `${n.label ?? n.id} (${n.appSlug ?? "unknown"})`,
        status: "completed" as const,
      }));
      await send({ type: "agent_activity", kind: "done", label: `Found ${steps.length} steps` });
      await send({
        type: "operation_card",
        operation: {
          title: result.applied ? "Workflow updated" : "Workflow planned",
          steps,
          status: "completed" as const,
          actions: [
            { label: "Test workflow", prompt: "Test this workflow" },
            { label: "Add a step", prompt: "Add the next step" },
          ],
        },
      });
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
    await send({ type: "agent_state", state: "error", title: "Error" });
    await send({ type: "agent_activity", kind: "error", label: "Request failed", detail: err instanceof Error ? err.message : "Copilot error" });
    await send({ type: "agent_error", message: err instanceof Error ? err.message : "Copilot error", recoverable: true });
    await send({ type: "error", message: err instanceof Error ? err.message : "Copilot error" });
    await send({ type: "done", status: "error", source: "copilot-chat-stream" });
  }
}

export async function refineCopilotSession(opts: { sessionId: string; orgId: string; userId?: string; userEmail?: string | null; prompt: string; mode?: unknown; graph?: unknown; flowId?: string; selectedStepId?: string }) {
  const session = await queryOne<{ proposed_definition: unknown; flow_id: string | null; mode: string }>(`SELECT proposed_definition, flow_id, mode FROM copilot_sessions WHERE id = $1 AND org_id = $2`, [opts.sessionId, opts.orgId]);
  const graph = opts.graph ? coerceWorkflowGraph(opts.graph) : session?.proposed_definition ? loadBuilderGraph(session.proposed_definition) : undefined;
  const ai = await probeAiService();
  if (ai.reachable && graph) {
    const refined = await signedAiJson<{ applied?: boolean; definition?: unknown; summary?: string; operations?: AgentOperation[]; needs_input?: string[]; issues?: Array<Record<string, unknown>>; publishable?: boolean }>("/copilot/refine", { definition: persistBuilderDraft(graph), instruction: opts.prompt, selected_step_id: opts.selectedStepId, catalog: listCatalogApps() }, opts.orgId);
    if (refined) {
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
