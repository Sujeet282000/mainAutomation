import { coerceWorkflowGraph, definitionHash, graphToFlowDefinition } from "@algoverge/core";
import type { WorkflowGraph } from "@algoverge/shared";
import { runAdapter } from "./adapters";
import { getApp } from "./catalog";
import { encryptJson, decryptJson } from "./crypto";
import { query, queryOne } from "./db";

export function persistBuilderDraft(graph: unknown) {
  try {
    const def = graphToFlowDefinition(graph);
    return { ...def, builderGraph: graph };
  } catch {
    return {
      schemaVersion: 1,
      trigger: { id: "trigger", type: "manual", props: {} },
      steps: [],
      settings: { timezone: "UTC" },
      builderGraph: graph,
    };
  }
}

export function loadBuilderGraph(draft: unknown): WorkflowGraph {
  const rec = draft && typeof draft === "object" ? (draft as Record<string, unknown>) : {};
  if (rec.builderGraph) return coerceWorkflowGraph(rec.builderGraph);
  return coerceWorkflowGraph(draft);
}

export async function ensureRunPartition() {
  await query(`SELECT internal.create_flow_run_partitions(1)`).catch(async () => {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const name = `flow_runs_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    await query(
      `CREATE TABLE IF NOT EXISTS public.${name} PARTITION OF public.flow_runs FOR VALUES FROM ($1) TO ($2)`,
      [start.toISOString(), end.toISOString()],
    ).catch(() => undefined);
  });
}

export async function ensureFlowVersion(opts: {
  orgId: string;
  flowId: string;
  definition: unknown;
  userId?: string;
}) {
  const hash = definitionHash(opts.definition);
  // First try exact hash match
  const existingRows = await query<{ id: string }>(
    `SELECT id FROM flow_versions WHERE flow_id = $1 AND definition_hash = $2`,
    [opts.flowId, hash],
  );
  if (existingRows[0]) return existingRows[0].id;

  // Fallback: use the latest version for this flow (avoids hash mismatches from normalization)
  const latestRows = await query<{ id: string }>(
    `SELECT id FROM flow_versions WHERE flow_id = $1 ORDER BY version_number DESC LIMIT 1`,
    [opts.flowId],
  );
  if (latestRows[0]) return latestRows[0].id;

  // Last resort: insert a new version
  const last = await queryOne<{ version_number: number }>(
    `SELECT version_number FROM flow_versions WHERE flow_id = $1 ORDER BY version_number DESC LIMIT 1`,
    [opts.flowId],
  );
  await query(
    `INSERT INTO flow_versions (org_id, flow_id, definition, definition_hash, version_number, published_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (flow_id, definition_hash) DO NOTHING`,
    [
      opts.orgId,
      opts.flowId,
      JSON.stringify(opts.definition),
      hash,
      (last?.version_number ?? 0) + 1,
      opts.userId ?? null,
    ],
  );
  const insertedRows = await query<{ id: string }>(
    `SELECT id FROM flow_versions WHERE flow_id = $1 ORDER BY version_number DESC LIMIT 1`,
    [opts.flowId],
  );
  return insertedRows[0]!.id;
}

export async function loadConnectionSecret(connectionId: string | null | undefined, orgId: string) {
  if (!connectionId) return null;
  const row = await queryOne<{ ciphertext: Buffer | null; encrypted_payload: unknown }>(
    `SELECT ciphertext, encrypted_payload FROM connections WHERE id = $1 AND org_id = $2`,
    [connectionId, orgId],
  );
  if (!row) return null;
  if (row.ciphertext) return decryptJson(row.ciphertext, orgId);
  if (row.encrypted_payload && typeof row.encrypted_payload === "object") {
    const blob = row.encrypted_payload as { _enc?: string };
    if (blob._enc) return decryptJson(Buffer.from(blob._enc, "base64"), orgId);
    return row.encrypted_payload as Record<string, unknown>;
  }
  return null;
}

export async function sealConnectionSecret(orgId: string, credentials: Record<string, unknown>) {
  const buf = encryptJson(credentials, orgId);
  return { ciphertext: buf, encrypted_payload: { _enc: buf.toString("base64") } };
}

function stepTypeOf(node: WorkflowGraph["nodes"][number]) {
  if (node.appSlug === "filter") return "filter";
  if (node.appSlug === "paths") return node.operation === "branch" ? "branch" : "router";
  if (node.appSlug === "loop") return "loop";
  if (node.appSlug === "delay") return "delay";
  if (node.appSlug === "approval") return "approval";
  if (node.appSlug === "code") return "code";
  if (node.appSlug === "http") return "http";
  if (["openai", "anthropic", "gemini", "ai"].includes(node.appSlug)) return "ai";
  if (node.appSlug === "agents") return "agent";
  if (node.appSlug === "tables") return "data_table";
  if (node.appSlug === "subflow") return "sub_flow";
  return "piece_action";
}

function children(graph: WorkflowGraph, nodeId: string) {
  return graph.edges
    .filter((e) => e.source === nodeId)
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter((n): n is WorkflowGraph["nodes"][number] => Boolean(n));
}

async function executeNode(opts: {
  node: WorkflowGraph["nodes"][number];
  ctx: { trigger: Record<string, unknown>; steps: Record<string, Record<string, unknown>> };
  orgId: string;
  runId: string;
}) {
  const { node, ctx, orgId, runId } = opts;
  if (node.type === "trigger" || !node.operation) {
    return { ok: true as const, output: { ...(ctx.trigger ?? {}), appSlug: node.appSlug, operation: node.operation } };
  }
  const app = getApp(node.appSlug);
  const op = app?.operations.find((o) => o.key === node.operation);
  const auth = await loadConnectionSecret(node.connectionId, orgId);
  const input = { ...(node.config ?? {}) };
  try {
    const result = await runAdapter({
      appSlug: node.appSlug,
      operation: node.operation,
      input,
      auth,
      workspaceId: orgId,
      executionId: runId,
      connectionId: node.connectionId ?? undefined,
    });
    return { ok: true as const, output: result.output ?? {} };
  } catch (err) {
    if (op?.outputSample && /No live adapter/.test(err instanceof Error ? err.message : "")) {
      return { ok: true as const, output: { ...(op.outputSample as Record<string, unknown>), _sample: true } };
    }
    throw err;
  }
}

export async function testFlowStep(opts: {
  orgId: string;
  flowId: string;
  nodeId: string;
  graph: unknown;
}) {
  const graph = loadBuilderGraph(opts.graph);
  const node = graph.nodes.find((n) => n.id === opts.nodeId);
  if (!node) throw new Error("Step not found");
  const ctx = { trigger: {}, steps: {} as Record<string, Record<string, unknown>> };
  const started = Date.now();
  const result = await executeNode({ node, ctx, orgId: opts.orgId, runId: opts.flowId });
  return { ok: result.ok, output: result.output, duration_ms: Date.now() - started, status: "succeeded" };
}

export async function createAndRunFlow(opts: {
  orgId: string;
  flowId: string;
  userId: string;
  payload?: Record<string, unknown>;
  graph?: unknown;
  triggerKind?: string;
  onStepComplete?: (step: { stepId: string; status: string; output?: unknown; error?: string; durationMs?: number }) => void;
}) {
  await ensureRunPartition();
  const flow = await queryOne<{ id: string; project_id: string; draft_definition: unknown; published_version_id: string | null }>(
    `SELECT id, project_id, draft_definition, published_version_id FROM flows WHERE id = $1 AND org_id = $2`,
    [opts.flowId, opts.orgId],
  );
  if (!flow) throw new Error("Flow not found");
  const draft = persistBuilderDraft(opts.graph ?? loadBuilderGraph(flow.draft_definition));
  const versionId = await ensureFlowVersion({
    orgId: opts.orgId,
    flowId: flow.id,
    definition: draft,
    userId: opts.userId,
  });
  const graph = loadBuilderGraph(draft);
  // Ensure project_id exists — create one if the flow doesn't have one
  let projectId = flow.project_id;
  if (!projectId) {
    const proj = await queryOne<{ id: string }>(
      `SELECT id FROM projects WHERE org_id = $1 LIMIT 1`,
      [opts.orgId],
    );
    projectId = proj?.id;
    if (!projectId) {
      const created = await queryOne<{ id: string }>(
        `INSERT INTO projects (org_id, name, slug) VALUES ($1, 'Default', 'default') RETURNING id`,
        [opts.orgId],
      );
      projectId = created!.id;
    }
    // Update the flow with the project_id
    await query(`UPDATE flows SET project_id = $1 WHERE id = $2`, [projectId, flow.id]).catch(() => undefined);
  }
  const runRows = await query<{ id: string; created_at: string }>(
    `INSERT INTO flow_runs (org_id, project_id, flow_id, flow_version_id, trigger_kind, status, context)
     VALUES ($1,$2,$3,$4,$5,'running',$6) RETURNING id, created_at`,
    [
      opts.orgId,
      projectId,
      flow.id,
      versionId,
      opts.triggerKind ?? "test",
      JSON.stringify({ trigger: opts.payload ?? { ping: true } }),
    ],
  );
  const run = runRows[0];
  if (!run) throw new Error("Failed to create execution run record.");
  const ctx = { trigger: opts.payload ?? { ping: true }, steps: {} as Record<string, Record<string, unknown>> };
  const ordered: WorkflowGraph["nodes"] = [];
  const seen = new Set<string>();
  const walk = (node: WorkflowGraph["nodes"][number]) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    ordered.push(node);
    for (const child of children(graph, node.id)) walk(child);
  };
  const trigger = graph.nodes.find((n) => n.type === "trigger") ?? graph.nodes[0];
  if (trigger) walk(trigger);

  let failed: string | null = null;
  let seq = 0;
  for (const node of ordered) {
    seq += 1;
    const started = new Date();
    try {
      const result = await executeNode({ node, ctx, orgId: opts.orgId, runId: run!.id });
      ctx.steps[node.id] = result.output;
      await query(
        `INSERT INTO run_steps (run_id, run_created_at, org_id, step_id, step_type, sequence_no, status, input_json, output_json, started_at, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,'succeeded',$7,$8,$9,now())`,
        [
          run!.id,
          run!.created_at,
          opts.orgId,
          node.id,
          stepTypeOf(node),
          seq,
          JSON.stringify(node.config ?? {}),
          JSON.stringify(result.output),
          started.toISOString(),
        ],
      );
      opts.onStepComplete?.({ stepId: node.id, status: "succeeded", output: result.output, durationMs: Date.now() - started.getTime() });
    } catch (err) {
      failed = err instanceof Error ? err.message : "step_failed";
      await query(
        `INSERT INTO run_steps (run_id, run_created_at, org_id, step_id, step_type, sequence_no, status, input_json, error_json, started_at, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,'failed',$7,$8,$9,now())`,
        [
          run!.id,
          run!.created_at,
          opts.orgId,
          node.id,
          stepTypeOf(node),
          seq,
          JSON.stringify(node.config ?? {}),
          JSON.stringify({ message: failed }),
          started.toISOString(),
        ],
      );
      opts.onStepComplete?.({ stepId: node.id, status: "failed", error: failed, durationMs: Date.now() - started.getTime() });
      break;
    }
  }

  await query(
    `UPDATE flow_runs SET status = $2, finished_at = now(), context = $3, steps_billable = $4 WHERE id = $1`,
    [run!.id, failed ? "failed" : "succeeded", JSON.stringify(ctx), Math.max(0, seq - 1)],
  );
  return { id: run!.id };
}

export function mapRunToExecution(row: Record<string, unknown>, steps: Array<Record<string, unknown>> = []) {
  return {
    execution: {
      id: row.id,
      status: row.status,
      automation_name: row.flow_name,
      automation_id: row.flow_id,
      trigger_type: row.trigger_kind,
      created_at: row.created_at,
      finished_at: row.finished_at,
      error: row.status === "failed" ? { message: "Run failed" } : undefined,
    },
    steps: steps.map((s) => ({
      id: s.id,
      step_id: s.step_id,
      name: s.step_id,
      status: s.status,
      duration_ms: s.duration_ms,
      error: typeof s.error_json === "object" && s.error_json
        ? s.error_json
        : s.error_json
          ? { message: String(s.error_json) }
          : undefined,
      output: s.output_json,
      input: s.input_json,
      app_slug: s.step_type,
    })),
    logs: [],
  };
}
