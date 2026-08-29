// =============================================================================
// Copilot Agent Tools — Workflow-level tools the AI agent can invoke
// These bridge the packages/ai-agent contract to real API operations.
// The AI never gets direct DB access — each tool goes through authorization.
// =============================================================================

import type { WorkflowGraph } from "@algoverge/shared";
import { coerceWorkflowGraph } from "@algoverge/core";
import { APP_CATALOG } from "../catalog/catalog";
import { query, queryOne } from "../db";
import { persistBuilderDraft, loadBuilderGraph } from "../flow-runtime";
import { pickForCopilot } from "../connections";
import { pieceRegistry } from "../pieces/registry";
import { validateWorkflowGraph } from "../workflow-validation";

export interface CopilotToolContext {
  workspaceId: string;
  userId: string;
  flowId?: string;
  versionId?: string;
  selectedNodeId?: string;
}

export interface CopilotToolResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

// ── Workflow Tools ──────────────────────────────────────────────────────────

export async function getWorkflow(ctx: CopilotToolContext): Promise<CopilotToolResult> {
  if (!ctx.flowId) {
    return { ok: false, error: { code: "NO_FLOW", message: "No workflow selected. Provide a flowId." } };
  }
  const flow = await queryOne<{ id: string; name: string; draft_definition: unknown; status: string }>(
    `SELECT id, name, draft_definition, status FROM flows WHERE id = $1 AND org_id = $2`,
    [ctx.flowId, ctx.workspaceId],
  );
  if (!flow) {
    return { ok: false, error: { code: "NOT_FOUND", message: `Workflow ${ctx.flowId} not found.` } };
  }
  let graph: WorkflowGraph | null = null;
  try {
    graph = coerceWorkflowGraph(flow.draft_definition);
  } catch {
    graph = loadBuilderGraph(flow.draft_definition) as WorkflowGraph;
  }
  const nodeSummaries = (graph?.nodes ?? []).map((n, i) => ({
    index: i + 1,
    id: n.id,
    type: n.type,
    appSlug: n.appSlug,
    operation: n.operation,
    label: n.label,
    hasConnection: Boolean(n.connectionId),
    selected: n.id === ctx.selectedNodeId,
  }));
  return {
    ok: true,
    data: {
      flowId: flow.id,
      name: flow.name,
      status: flow.status,
      nodeCount: graph?.nodes?.length ?? 0,
      nodes: nodeSummaries,
      edges: graph?.edges ?? [],
      selectedNodeId: ctx.selectedNodeId,
    },
  };
}

export async function validateWorkflow(ctx: CopilotToolContext): Promise<CopilotToolResult> {
  if (!ctx.flowId) {
    return { ok: false, error: { code: "NO_FLOW", message: "No workflow to validate." } };
  }
  const flow = await queryOne<{ draft_definition: unknown }>(
    `SELECT draft_definition FROM flows WHERE id = $1 AND org_id = $2`,
    [ctx.flowId, ctx.workspaceId],
  );
  if (!flow) {
    return { ok: false, error: { code: "NOT_FOUND", message: "Workflow not found." } };
  }
  const { issues } = await validateWorkflowGraph(flow.draft_definition as Record<string, unknown>, { workspaceId: ctx.workspaceId, strict: false });
  return {
    ok: issues.length === 0,
    data: { issues, publishable: issues.length === 0 },
  };
}

// ── Integration Tools ───────────────────────────────────────────────────────

export async function listIntegrations(query_text?: string): Promise<CopilotToolResult> {
  const apps = APP_CATALOG.map((a) => ({
    slug: a.slug,
    name: a.name,
    authType: a.authType ?? "none",
    operationCount: a.operations.length,
    triggers: a.operations.filter((o) => o.type === "trigger").map((o) => ({ key: o.key, name: o.name })),
    actions: a.operations.filter((o) => o.type !== "trigger").map((o) => ({ key: o.key, name: o.name })),
  }));
  if (query_text) {
    const lower = query_text.toLowerCase();
    const filtered = apps.filter(
      (a) => a.slug.includes(lower) || a.name.toLowerCase().includes(lower) ||
        a.triggers.some((t) => t.name.toLowerCase().includes(lower)) ||
        a.actions.some((ac) => ac.name.toLowerCase().includes(lower)),
    );
    return { ok: true, data: filtered };
  }
  return { ok: true, data: apps };
}

export async function getIntegrationSchema(slug: string): Promise<CopilotToolResult> {
  const app = APP_CATALOG.find((a) => a.slug === slug);
  if (!app) {
    return { ok: false, error: { code: "NOT_FOUND", message: `Integration "${slug}" not found.` } };
  }
  return {
    ok: true,
    data: {
      slug: app.slug,
      name: app.name,
      authType: app.authType ?? "none",
      operations: app.operations.map((o) => ({
        key: o.key,
        name: o.name,
        type: o.type,
        inputFields: (o.inputFields ?? []).map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required,
        })),
        outputSample: o.outputSample ? Object.keys(o.outputSample) : [],
      })),
    },
  };
}

export async function listConnections(ctx: CopilotToolContext, pieceName?: string): Promise<CopilotToolResult> {
  let q = `SELECT id, piece_name, label, status, owner_email, use_count FROM connections WHERE org_id = $1`;
  const params: unknown[] = [ctx.workspaceId];
  if (pieceName) {
    q += ` AND piece_name = $2`;
    params.push(pieceName);
  }
  q += ` ORDER BY created_at DESC`;
  const rows = await query(q, params);
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      pieceName: r.piece_name,
      label: r.label,
      status: r.status,
      ownerEmail: r.owner_email,
      useCount: r.use_count,
    })),
  };
}

// ── Execution Tools ─────────────────────────────────────────────────────────

export async function inspectRun(runId: string, workspaceId: string): Promise<CopilotToolResult> {
  const run = await queryOne<{ id: string; status: string; error: string | null; context: unknown }>(
    `SELECT id, status, error, context FROM flow_runs WHERE id = $1 AND org_id = $2`,
    [runId, workspaceId],
  );
  if (!run) {
    return { ok: false, error: { code: "NOT_FOUND", message: `Run ${runId} not found.` } };
  }
  const steps = await query<{ step_id: string; status: string; error_json: unknown; duration_ms: number | null }>(
    `SELECT step_id, status, error_json, duration_ms FROM run_steps WHERE run_id = $1 ORDER BY sequence_no ASC`,
    [runId],
  );
  return {
    ok: true,
    data: {
      runId: run.id,
      status: run.status,
      error: run.error,
      steps: steps.map((s) => ({
        stepId: s.step_id,
        status: s.status,
        error: s.error_json,
        durationMs: s.duration_ms,
      })),
    },
  };
}

// ── Tool Registry Map ───────────────────────────────────────────────────────

export const COPILOT_TOOLS: Record<string, (ctx: CopilotToolContext, input: Record<string, unknown>) => Promise<CopilotToolResult>> = {
  "workflow.get": (ctx) => getWorkflow(ctx),
  "workflow.validate": (ctx) => validateWorkflow(ctx),
  "integrations.search": (_ctx, input) => listIntegrations(String(input.query ?? "")),
  "integrations.schema": (_ctx, input) => getIntegrationSchema(String(input.slug ?? "")),
  "connections.list": (ctx, input) => listConnections(ctx, input.pieceName as string | undefined),
  "execution.inspect": (_ctx, input) => inspectRun(String(input.runId ?? ""), _ctx.workspaceId),
};
