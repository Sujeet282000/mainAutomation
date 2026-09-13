import { coerceWorkflowGraph, definitionHash, graphToFlowDefinition, resolveValue } from "@algoverge/core";
import type { WorkflowGraph } from "@algoverge/shared";
import { runAdapter } from "./adapters";
import { getApp } from "./catalog/catalog";
import { encryptJson, decryptJson, redact } from "./crypto";
import { query, queryOne, withTransaction } from "./db";
import { queues } from "./queue";
import { isAuthError } from "./runtime-guards";
import { buildTriggerEnvelope } from "./trigger-envelope";

export function persistBuilderDraft(graph: unknown) {
  try { const def = graphToFlowDefinition(graph); return { ...def, builderGraph: graph }; }
  catch { return { schemaVersion: 1, trigger: { id: "trigger", type: "manual", props: {} }, steps: [], settings: { timezone: "UTC" }, builderGraph: graph }; }
}
export function loadBuilderGraph(draft: unknown): WorkflowGraph {
  const rec = draft && typeof draft === "object" ? (draft as Record<string, unknown>) : {};
  if (rec.builderGraph) return coerceWorkflowGraph(rec.builderGraph);
  return coerceWorkflowGraph(draft);
}

export async function ensureRunPartition() {
  const dates = [new Date(), new Date()]; dates[1].setUTCMonth(dates[1].getUTCMonth() + 1);
  for (const date of dates) {
    const start = new Date(date); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
    const name = `flow_runs_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    try {
      await query(`CREATE TABLE IF NOT EXISTS public."${name}" PARTITION OF public.flow_runs FOR VALUES FROM ($1) TO ($2)`, [start.toISOString().replace("T", " ").replace(".000Z", ""), end.toISOString().replace("T", " ").replace(".000Z", "")]);
    } catch { /* partition already exists */ }
  }
}

/** Return the exact immutable version for this definition; never silently fall back to another version. */
export async function ensureFlowVersion(opts: { orgId: string; flowId: string; definition: unknown; userId?: string }) {
  const hash = definitionHash(opts.definition);
  const exact = await queryOne<{ id: string }>(`SELECT id FROM flow_versions WHERE flow_id=$1 AND definition_hash=$2`, [opts.flowId, hash]);
  if (exact) return exact.id;
  const last = await queryOne<{ version_number: number }>(`SELECT version_number FROM flow_versions WHERE flow_id=$1 ORDER BY version_number DESC LIMIT 1`, [opts.flowId]);
  await query(`INSERT INTO flow_versions (org_id,flow_id,definition,definition_hash,version_number,published_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (flow_id,definition_hash) DO NOTHING`, [opts.orgId, opts.flowId, JSON.stringify(opts.definition), hash, (last?.version_number ?? 0) + 1, opts.userId ?? null]);
  const created = await queryOne<{ id: string }>(`SELECT id FROM flow_versions WHERE flow_id=$1 AND definition_hash=$2`, [opts.flowId, hash]);
  if (!created) throw new Error("FLOW_VERSION_CREATE_FAILED");
  return created.id;
}

export async function loadConnectionSecret(connectionId: string | null | undefined, orgId: string) {
  if (!connectionId) return null;
  try {
    const { ensureFreshToken } = await import("./oauth-refresh");
    const piece = await queryOne<{ piece_name: string }>(`SELECT piece_name FROM connections WHERE id=$1 AND org_id=$2`, [connectionId, orgId]);
    const fresh = await ensureFreshToken(connectionId, orgId, piece?.piece_name ?? "");
    if (fresh) return fresh;
  } catch { /* fallback to stored credential */ }
  const row = await queryOne<{ ciphertext: Buffer | null; encrypted_payload: unknown }>(`SELECT ciphertext,encrypted_payload FROM connections WHERE id=$1 AND org_id=$2`, [connectionId, orgId]);
  if (!row) return null;
  if (row.ciphertext) return decryptJson(row.ciphertext, orgId);
  if (row.encrypted_payload && typeof row.encrypted_payload === "object") {
    const blob = row.encrypted_payload as { _enc?: string };
    if (blob._enc) return decryptJson(Buffer.from(blob._enc, "base64"), orgId);
    return row.encrypted_payload as Record<string, unknown>;
  }
  return null;
}
export async function sealConnectionSecret(orgId: string, credentials: Record<string, unknown>) { const buf = encryptJson(credentials, orgId); return { ciphertext: buf, encrypted_payload: { _enc: buf.toString("base64") } }; }

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
function children(graph: WorkflowGraph, nodeId: string, handle?: string | null) {
  return graph.edges.filter((e) => e.source === nodeId && (handle == null || e.sourceHandle === handle)).map((e) => graph.nodes.find((n) => n.id === e.target)).filter((n): n is WorkflowGraph["nodes"][number] => Boolean(n));
}
function resolveStepInput(node: WorkflowGraph["nodes"][number], ctx: { trigger: Record<string, unknown>; steps: Record<string, Record<string, unknown>>; vars?: Record<string, unknown>; item?: unknown }) {
  return resolveValue({ ...(node.config ?? {}) }, { trigger: ctx.trigger ?? {}, steps: ctx.steps, vars: ctx.vars ?? {}, item: ctx.item }) as Record<string, unknown>;
}
function compareCondition(operator: string, left: unknown, right: unknown) {
  switch (operator) {
    case "equals": case "eq": return left === right || String(left) === String(right);
    case "not_equals": case "neq": return !(left === right || String(left) === String(right));
    case "contains": return Array.isArray(left) ? left.includes(right) : String(left ?? "").includes(String(right ?? ""));
    case "not_contains": return !compareCondition("contains", left, right);
    case "starts_with": return String(left ?? "").startsWith(String(right ?? ""));
    case "ends_with": return String(left ?? "").endsWith(String(right ?? ""));
    case "gt": return Number(left) > Number(right); case "gte": return Number(left) >= Number(right);
    case "lt": return Number(left) < Number(right); case "lte": return Number(left) <= Number(right);
    case "exists": case "not_empty": return left !== undefined && left !== null && left !== "";
    case "not_exists": case "empty": return left === undefined || left === null || left === "";
    default: return false;
  }
}
function graphCondition(node: WorkflowGraph["nodes"][number], ctx: { trigger: Record<string, unknown>; steps: Record<string, Record<string, unknown>>; vars?: Record<string, unknown>; item?: unknown }) {
  const cfg = node.config ?? {};
  const scope = { trigger: ctx.trigger, steps: ctx.steps, vars: ctx.vars ?? {}, item: ctx.item };
  return compareCondition(String(cfg.operator ?? "equals"), resolveValue(cfg.left, scope), resolveValue(cfg.right, scope));
}

async function executeNode(opts: { node: WorkflowGraph["nodes"][number]; ctx: { trigger: Record<string, unknown>; steps: Record<string, Record<string, unknown>>; vars?: Record<string, unknown>; item?: unknown }; orgId: string; runId: string; graph?: WorkflowGraph; allowSamples?: boolean }) {
  const { node, ctx, orgId, runId } = opts;
  if (node.type === "trigger" || !node.operation) return { output: { ...(ctx.trigger ?? {}), appSlug: node.appSlug, operation: node.operation }, input: { ...(node.config ?? {}) } as Record<string, unknown> };
  const app = getApp(node.appSlug); const op = app?.operations.find((o) => o.key === node.operation); const auth = await loadConnectionSecret(node.connectionId, orgId); const input = resolveStepInput(node, ctx);
  try {
    const result = await runAdapter({ appSlug: node.appSlug, operation: node.operation, input, auth, workspaceId: orgId, executionId: runId, connectionId: node.connectionId ?? undefined });
    return { output: result.output ?? {}, input };
  } catch (err) {
    if (opts.allowSamples && op?.outputSample && /No live adapter/.test(err instanceof Error ? err.message : "")) return { output: { ...(op.outputSample as Record<string, unknown>), _sample: true }, input };
    throw err;
  }
}

/** Step-test execution follows the real trigger-to-target path instead of executing only the selected node. */
async function executeToTarget(graph: WorkflowGraph, nodeId: string, ctx: { trigger: Record<string, unknown>; steps: Record<string, Record<string, unknown>>; vars: Record<string, unknown>; item?: unknown }, orgId: string, runId: string, visited = new Set<string>()): Promise<boolean> {
  const node = graph.nodes.find((n) => n.id === nodeId); if (!node || visited.has(node.id)) return false;
  visited.add(node.id);
  if (node.type !== "trigger") {
    if (node.appSlug === "filter" && !graphCondition(node, ctx)) return false;
    if (node.appSlug === "paths" && node.operation === "branch") {
      const handle = graphCondition(node, ctx) ? "true" : "false";
      for (const child of children(graph, node.id, handle)) if (await executeToTarget(graph, child.id, ctx, orgId, runId, visited)) return true;
      return false;
    }
    if (node.appSlug === "loop") {
      const input = resolveStepInput(node, ctx); const items = Array.isArray(input.items) ? input.items : [];
      for (let i = 0; i < items.length; i++) {
        const loopCtx = { ...ctx, item: items[i], vars: { ...ctx.vars, loop: { item: items[i], index: i, total: items.length } } };
        for (const child of children(graph, node.id)) if (await executeToTarget(graph, child.id, loopCtx, orgId, runId, new Set<string>())) return true;
      }
      return false;
    }
    const result = await executeNode({ node, ctx, orgId, runId, graph, allowSamples: true });
    ctx.steps[node.id] = result.output;
    if (node.id === nodeId) return true;
  } else if (node.id === nodeId) return true;
  if (node.appSlug === "paths") {
    // For step testing, prefer the branch containing the requested target.
    const incoming = graph.edges.find((e) => e.source === node.id && graph.nodes.some((n) => n.id === e.target && (n.id === nodeId || graph.edges.some((x) => x.target === n.id && x.source === n.id))));
    const next = incoming ? children(graph, node.id, incoming.sourceHandle) : children(graph, node.id);
    for (const child of next) if (await executeToTarget(graph, child.id, ctx, orgId, runId, visited)) return true;
    return false;
  }
  for (const child of children(graph, node.id)) if (await executeToTarget(graph, child.id, ctx, orgId, runId, visited)) return true;
  return false;
}

export async function testFlowStep(opts: { orgId: string; flowId: string; nodeId: string; graph: unknown; inputs?: Record<string, unknown> }) {
  const graph = loadBuilderGraph(opts.graph); if (!graph.nodes.some((n) => n.id === opts.nodeId)) throw new Error("Step not found");
  const trigger = graph.nodes.find((n) => n.type === "trigger"); const sample = (trigger?.config?.sampleOutput ?? trigger?.config?.testData ?? {}) as Record<string, unknown>;
  const ctx = { trigger: { ...sample, ...(opts.inputs ?? {}) }, steps: {} as Record<string, Record<string, unknown>>, vars: {} as Record<string, unknown> };
  const started = Date.now();
  try {
    const reached = await executeToTarget(graph, trigger?.id ?? graph.nodes[0].id, ctx, opts.orgId, `test:${opts.flowId}:${opts.nodeId}:${Date.now()}`);
    if (!reached) return { ok: false, output: undefined, error: "Unable to reach target step from the trigger", duration_ms: Date.now() - started, status: "failed" };
    return { ok: true, output: ctx.steps[opts.nodeId], error: undefined, duration_ms: Date.now() - started, status: "succeeded" };
  } catch (err) {
    return { ok: false, output: undefined, error: err instanceof Error ? err.message : "Step failed", duration_ms: Date.now() - started, status: "failed" };
  }
}

export async function createAndRunFlow(opts: { orgId: string; flowId: string; userId: string; payload?: Record<string, unknown>; graph?: unknown; triggerKind?: string; eventId?: string | null; idempotencyKey?: string | null; receivedAt?: string; replaySteps?: Record<string, Record<string, unknown>>; onStepComplete?: (step: { stepId: string; status: string; output?: unknown; error?: string; durationMs?: number }) => void }) {
  await ensureRunPartition();
  const flow = await queryOne<{ id: string; project_id: string; draft_definition: unknown; published_version_id: string | null }>(`SELECT id,project_id,draft_definition,published_version_id FROM flows WHERE id=$1 AND org_id=$2`, [opts.flowId, opts.orgId]);
  if (!flow) throw new Error("Flow not found");
  const isTest = opts.triggerKind === "test" || opts.triggerKind === "manual_test";
  let versionId: string;
  if (isTest) {
    const draft = persistBuilderDraft(opts.graph ?? loadBuilderGraph(flow.draft_definition));
    versionId = await ensureFlowVersion({ orgId: opts.orgId, flowId: flow.id, definition: draft, userId: opts.userId });
  } else {
    if (!flow.published_version_id) throw new Error("FLOW_NOT_PUBLISHED");
    const published = await queryOne<{ id: string }>(`SELECT id FROM flow_versions WHERE id=$1 AND flow_id=$2`, [flow.published_version_id, flow.id]);
    if (!published) throw new Error("PUBLISHED_FLOW_VERSION_NOT_FOUND");
    versionId = published.id;
  }
  let projectId = flow.project_id;
  if (!projectId) {
    const project = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE org_id=$1 LIMIT 1`, [opts.orgId]);
    projectId = project?.id;
    if (!projectId) { const created = await queryOne<{ id: string }>(`INSERT INTO projects (org_id,name,slug) VALUES ($1,'Default','default') RETURNING id`, [opts.orgId]); projectId = created!.id; }
    await query(`UPDATE flows SET project_id=$1 WHERE id=$2`, [projectId, flow.id]);
  }
  const triggerEnvelope = buildTriggerEnvelope({ workspaceId: opts.orgId, organizationId: opts.orgId, automationId: flow.id, versionId, triggerType: opts.triggerKind ?? "manual", payload: opts.payload ?? { ping: true }, eventId: opts.eventId, idempotencyKey: opts.idempotencyKey, receivedAt: opts.receivedAt });
  const claimed = await withTransaction(async (client) => {
    if (triggerEnvelope.idempotencyKey) {
      const claim = await client.query<{ flow_run_id: string | null }>(`INSERT INTO trigger_events (org_id,workspace_id,automation_id,version_id,event_id,trigger_type,received_at,idempotency_key,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (org_id,idempotency_key) DO NOTHING RETURNING flow_run_id`, [opts.orgId,opts.orgId,flow.id,versionId,triggerEnvelope.eventId,triggerEnvelope.triggerType,triggerEnvelope.receivedAt,triggerEnvelope.idempotencyKey,JSON.stringify(triggerEnvelope.payload)]);
      if (!claim.rows[0]) {
        const existing = await client.query<{ flow_run_id: string | null }>(`SELECT flow_run_id FROM trigger_events WHERE org_id=$1 AND idempotency_key=$2 FOR UPDATE`, [opts.orgId,triggerEnvelope.idempotencyKey]);
        if (existing.rows[0]?.flow_run_id) return { id: existing.rows[0].flow_run_id, duplicate: true };
        throw new Error("TRIGGER_EVENT_CLAIM_INCOMPLETE");
      }
    }
    const inserted = await client.query<{ id: string }>(`INSERT INTO flow_runs (org_id,project_id,flow_id,flow_version_id,trigger_kind,trigger_event_id,idempotency_key,status,context) VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8) RETURNING id`, [opts.orgId,projectId,flow.id,versionId,triggerEnvelope.triggerType,triggerEnvelope.eventId,triggerEnvelope.idempotencyKey,JSON.stringify({ trigger: triggerEnvelope.payload })]);
    const created = inserted.rows[0]; if (!created) throw new Error("Failed to create execution run record.");
    if (triggerEnvelope.idempotencyKey) await client.query(`UPDATE trigger_events SET flow_run_id=$1 WHERE org_id=$2 AND idempotency_key=$3`, [created.id,opts.orgId,triggerEnvelope.idempotencyKey]);
    return { id: created.id, duplicate: false };
  });
  if (claimed.duplicate) return { id: claimed.id, duplicate: true };
  await queues.flowSteps.add("transition", { runId: claimed.id, orgId: opts.orgId, cursor: 0, epoch: 1 }, { jobId: `step:${claimed.id}:0:1`, attempts: 3, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 1000, removeOnFail: 5000 });
  // Execution is now asynchronous and authoritative in packages/engine. The UI
  // should subscribe to /executions/:id/stream rather than simulating progress.
  return { id: claimed.id };
}

export function mapRunToExecution(row: Record<string, unknown>, steps: Array<Record<string, unknown>> = []) {
  const firstFailed = steps.find((s) => s.status === "failed");
  const runError = typeof firstFailed?.error_json === "object" && firstFailed?.error_json ? firstFailed.error_json : firstFailed?.error_json ? { message: String(firstFailed.error_json) } : { message: "Run failed" };
  return { execution: { id: row.id, status: row.status, automation_name: row.flow_name, automation_id: row.flow_id, trigger_type: row.trigger_kind, created_at: row.created_at, finished_at: row.finished_at, error: row.status === "failed" ? runError : undefined }, steps: steps.map((s) => ({ id: s.id, step_id: s.step_id, name: s.step_id, status: s.status, duration_ms: s.duration_ms, error: typeof s.error_json === "object" && s.error_json ? s.error_json : s.error_json ? { message: String(s.error_json) } : undefined, output: s.output_json, input: s.input_json, app_slug: s.step_type })), logs: [] };
}
