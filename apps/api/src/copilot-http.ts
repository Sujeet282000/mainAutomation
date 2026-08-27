import type { Request, Response } from "express";
import { coerceWorkflowGraph } from "@algoverge/core";
import { query, queryOne } from "./db";
import { persistBuilderDraft, loadBuilderGraph } from "./flow-runtime";
import { copilotChat } from "./copilot";
import { runCopilotEngine } from "./copilot-engine";
import { parseCopilotMode } from "./copilot-pipeline";
import { probeAiService, signedAiJson, streamAiCopilotGenerate } from "./ai-service";
import { listCatalogApps } from "./catalog";
import { applyAgentOperations, type AgentOperation } from "./agent-operation-applier";

const STAGE_FOR_DB: Record<string, string> = { connect: "connections", schema: "schemas", map: "mapping" };
const PERSISTABLE_EVENTS = new Set(["stage", "reasoning", "proposal", "applied", "todo", "usage", "done", "error"]);
const PERSISTABLE_STAGES = new Set(["intent", "retrieve", "select", "connections", "schemas", "mapping", "assemble", "validate", "repair", "persist"]);

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
            const requiresReview = grounded.needsConfirmation.length > 0 || grounded.rejected.length > 0;
            const persisted = requiresReview ? null : await persistGroundedGraph(opts.sessionId, grounded.graph);
            sawResult = true;
            await send({ ...ev, graph: requiresReview ? rawGraph ?? ev.graph : persisted!.graph, definition: persisted?.definition, operations, applied_operations: grounded.applied, rejected_operations: grounded.rejected, needs_confirmation: grounded.needsConfirmation, issues: grounded.issues, applied: !requiresReview && grounded.applied.length > 0, mode, source: "python-copilot" });
            const needsApproval = grounded.needsConfirmation.length > 0 || grounded.rejected.length > 0;
            const persisted = await persistGroundedGraph(opts.sessionId, grounded.graph, needsApproval ? operations : undefined);
            sawResult = true;
            await send({ ...ev, graph: persisted.graph, definition: persisted.definition, sessionId: opts.sessionId, operations, applied_operations: grounded.applied, rejected_operations: grounded.rejected, needs_confirmation: grounded.needsConfirmation, issues: grounded.issues, applied: mode === "auto_build" && grounded.needsConfirmation.length === 0 && grounded.rejected.length === 0, mode, source: "python-copilot" });
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
  const result = await copilotChat({ prompt: opts.prompt, workspaceId: opts.orgId, organizationId: opts.orgId, userId: opts.userId, userEmail: opts.userEmail, automationId: opts.flowId ?? session?.flow_id ?? undefined, graph, selectedStepId: opts.selectedStepId, mode: parseCopilotMode(opts.mode ?? session?.mode) });
  if (result.graph) await query(`UPDATE copilot_sessions SET proposed_definition = $1, updated_at = now() WHERE id = $2`, [JSON.stringify(persistBuilderDraft(result.graph)), opts.sessionId]);
  return result;
}
