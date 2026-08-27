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

const STAGE_FOR_DB: Record<string, string> = {
  connect: "connections",
  schema: "schemas",
  map: "mapping",
};

const PERSISTABLE_EVENTS = new Set(["stage", "reasoning", "proposal", "applied", "todo", "usage", "done", "error"]);
const PERSISTABLE_STAGES = new Set([
  "intent",
  "retrieve",
  "select",
  "connections",
  "schemas",
  "mapping",
  "assemble",
  "validate",
  "repair",
  "persist",
]);

export async function ensureProjectId(orgId: string) {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM projects WHERE org_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [orgId],
  );
  if (existing) return existing.id;
  const created = await queryOne<{ id: string }>(
    `INSERT INTO projects (org_id, name, slug) VALUES ($1, 'Main', 'main') RETURNING id`,
    [orgId],
  );
  return created!.id;
}

async function logCopilotEvent(
  orgId: string,
  sessionId: string,
  sequenceNo: number,
  event: Record<string, unknown>,
) {
  const type = String(event.type ?? "");
  if (!PERSISTABLE_EVENTS.has(type)) return;
  const rawStage = event.stage ? String(event.stage) : undefined;
  const stage = rawStage ? (STAGE_FOR_DB[rawStage] ?? rawStage) : null;
  if (stage && !PERSISTABLE_STAGES.has(stage)) return;
  await query(
    `INSERT INTO copilot_events (org_id, session_id, sequence_no, event_type, stage, payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (session_id, sequence_no) DO NOTHING`,
    [orgId, sessionId, sequenceNo, type, stage, JSON.stringify(event)],
  ).catch(() => undefined);
}

/** Stream Copilot: Python AI plane first, Node catalog engine as fallback. */
export async function streamCopilotSession(opts: {
  req: Request;
  res: Response;
  sessionId: string;
  orgId: string;
  prompt: string;
  mode?: unknown;
  graph?: unknown;
  flowId?: string;
  projectId?: string;
}) {
  const mode = parseCopilotMode(opts.mode);
  let graph;
  try {
    graph = opts.graph ? coerceWorkflowGraph(opts.graph) : undefined;
  } catch {
    graph = undefined;
  }
  let seq = 0;
  const send = async (event: Record<string, unknown>) => {
    opts.res.write(`data: ${JSON.stringify(event)}\n\n`);
    seq += 1;
    await logCopilotEvent(opts.orgId, opts.sessionId, seq, event);
  };

  const persistGraph = async (raw: unknown, summary: string, source: string) => {
    try {
      const coerced = coerceWorkflowGraph(raw);
      const definition = persistBuilderDraft(coerced);
      await query(`UPDATE copilot_sessions SET proposed_definition = $1, stage = 'persist', updated_at = now() WHERE id = $2`, [
        JSON.stringify(definition),
        opts.sessionId,
      ]);
      return { graph: coerced, definition, summary, source };
    } catch {
      return null;
    }
  };

  const ai = await probeAiService();
  if (ai.reachable) {
    try {
      await send({
        type: "reasoning",
        text: ai.hint,
        stage: "intent",
      });
      let sawResult = false;
      for await (const ev of streamAiCopilotGenerate({
        sessionId: opts.sessionId,
        flowId: opts.flowId || opts.sessionId,
        prompt: opts.prompt,
        orgId: opts.orgId,
        userEmail: opts.req.user?.email ?? "",
        projectId: opts.projectId || opts.orgId,
        autonomy: mode,
      })) {
        if (ev.type === "result" || ev.type === "proposal") {
          const rawGraph = ev.graph ?? (ev.definition as Record<string, unknown> | undefined);
          if (rawGraph) {
            const persisted = await persistGraph(rawGraph, String(ev.summary ?? ""), String(ev.source ?? "python-copilot"));
            if (persisted) {
              sawResult = true;
              await send({
                ...ev,
                type: ev.type,
                graph: persisted.graph,
                definition: persisted.definition,
                applied: mode === "auto_build" && ev.type === "result" ? ev.applied !== false : ev.applied,
                mode,
                source: persisted.source,
              });
              continue;
            }
          }
        }
        await send({
          ...ev,
          stage: STAGE_FOR_DB[String(ev.stage ?? "")] ?? ev.stage,
          label: ev.label ?? ev.stage,
        });
      }
      if (sawResult) {
        await send({
          type: "done",
          status: "draft_saved",
          publishable: true,
          note: "Review and publish. Copilot never publishes.",
          source: "python-copilot",
        });
        return;
      }
    } catch (err) {
      await send({
        type: "reasoning",
        text: `AI plane failed (${err instanceof Error ? err.message : "error"}); using the Node catalog engine.`,
      });
    }
  } else {
    await send({ type: "reasoning", text: ai.hint });
  }

  for await (const ev of runCopilotEngine({
    prompt: opts.prompt,
    workspaceId: opts.orgId,
    userEmail: opts.req.user?.email,
    mode,
    graph,
  })) {
    if (ev.type === "result") {
      const definition = persistBuilderDraft(ev.result.graph);
      await query(`UPDATE copilot_sessions SET proposed_definition = $1, stage = 'persist', updated_at = now() WHERE id = $2`, [
        JSON.stringify(definition),
        opts.sessionId,
      ]);
      await send({
        type: "proposal",
        graph: ev.result.graph,
        definition,
        summary: ev.result.summary,
        applied: mode === "auto_build",
        rebuilt: ev.result.rebuilt,
        changed: ev.result.changed,
        source: ev.result.source,
        mode,
      });
      await send({
        type: "result",
        graph: ev.result.graph,
        summary: ev.result.summary,
        applied: mode === "auto_build",
        rebuilt: ev.result.rebuilt,
        changed: ev.result.changed,
        source: ev.result.source,
        mode,
      });
    } else if (ev.type === "stage") {
      await send({
        type: "stage",
        stage: STAGE_FOR_DB[ev.stage] ?? ev.stage,
        label: ev.label,
      });
    } else {
      await send(ev as Record<string, unknown>);
    }
  }
  await send({
    type: "done",
    status: "draft_saved",
    publishable: true,
    note: "Review and publish. Copilot never publishes.",
    source: "node-engine",
  });
}

export async function refineCopilotSession(opts: {
  sessionId: string;
  orgId: string;
  userId?: string;
  userEmail?: string | null;
  prompt: string;
  mode?: unknown;
  graph?: unknown;
  flowId?: string;
  selectedStepId?: string;
}) {
  const session = await queryOne<{ proposed_definition: unknown; flow_id: string | null; mode: string }>(
    `SELECT proposed_definition, flow_id, mode FROM copilot_sessions WHERE id = $1 AND org_id = $2`,
    [opts.sessionId, opts.orgId],
  );
  const graph = opts.graph
    ? coerceWorkflowGraph(opts.graph)
    : session?.proposed_definition
      ? loadBuilderGraph(session.proposed_definition)
      : undefined;
  const ai = await probeAiService();
  if (ai.reachable && graph) {
    const refined = await signedAiJson<{
      applied?: boolean;
      definition?: unknown;
      summary?: string;
      operations?: Array<{
        kind: string;
        arguments: Record<string, unknown>;
        requires_confirmation?: boolean;
      }>;
      needs_input?: string[];
      issues?: Array<Record<string, unknown>>;
      publishable?: boolean;
    }>(
      "/copilot/refine",
      {
        definition: persistBuilderDraft(graph),
        instruction: opts.prompt,
        selected_step_id: opts.selectedStepId,
        catalog: listCatalogApps(),
      },
      opts.orgId,
    );

    if (refined) {
      const operations = (refined.operations ?? []) as AgentOperation[];
      const operationResult = operations.length
        ? await applyAgentOperations({
            graph,
            operations,
            workspaceId: opts.orgId,
            organizationId: opts.orgId,
            allowDestructive: parseCopilotMode(opts.mode ?? session?.mode) === "auto_build",
          })
        : {
            graph,
            applied: [],
            rejected: [],
            needsConfirmation: [],
            issues: [],
          };

      const nextGraph = operationResult.graph;
      const changed = JSON.stringify(nextGraph) !== JSON.stringify(graph);
      const definition = persistBuilderDraft(nextGraph);
      const canPersist = operationResult.rejected.length === 0 && operationResult.needsConfirmation.length === 0;

      if (changed && canPersist) {
        await query(
          `UPDATE copilot_sessions SET proposed_definition = $1, stage = 'persist', updated_at = now() WHERE id = $2`,
          [JSON.stringify(definition), opts.sessionId],
        );
      }

      return {
        reply: refined.summary ?? (changed ? "I updated the workflow draft." : "I prepared a plan for the requested change."),
        graph: nextGraph,
        definition,
        applied: operationResult.applied.length > 0,
        changed,
        summary: refined.summary,
        operations,
        applied_operations: operationResult.applied,
        rejected_operations: operationResult.rejected,
        needs_confirmation: operationResult.needsConfirmation,
        needs_input: refined.needs_input ?? [],
        issues: [...(refined.issues ?? []), ...operationResult.issues],
        publishable: Boolean(refined.publishable) && operationResult.issues.length === 0 && operationResult.rejected.length === 0,
        source: "python-copilot",
      };
    }
  }

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
  });
  if (result.graph) {
    await query(`UPDATE copilot_sessions SET proposed_definition = $1, updated_at = now() WHERE id = $2`, [
      JSON.stringify(persistBuilderDraft(result.graph)),
      opts.sessionId,
    ]);
  }
  return result;
}
