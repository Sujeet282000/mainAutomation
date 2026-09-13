import { coerceWorkflowGraph, definitionHash, graphToFlowDefinition, resolveValue } from "@algoverge/core";
import { parseErrorPolicy } from "@algoverge/shared";
import type { WorkflowGraph } from "@algoverge/shared";
import { runAdapter } from "./adapters";
import { getApp } from "./catalog/catalog";
import { encryptJson, decryptJson, redact } from "./crypto";
import { query, queryOne, withTransaction } from "./db";
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
  const months = [new Date()]; const nextMonth = new Date(); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1); months.push(nextMonth);
  for (const date of months) {
    const start = new Date(date); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
    const name = `flow_runs_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    const startStr = start.toISOString().replace("T", " ").replace(".000Z", "");
    const endStr = end.toISOString().replace("T", " ").replace(".000Z", "");
    try {
      await query(`CREATE TABLE IF NOT EXISTS public."${name}" PARTITION OF public.flow_runs FOR VALUES FROM ($1) TO ($2)`, [startStr, endStr]);
      await query(`DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='${name}' AND indexdef LIKE '%(id, created_at, org_id)%') THEN EXECUTE 'CREATE UNIQUE INDEX "${name}_id_created_at_org_id_idx" ON public."${name}" (id, created_at, org_id)'; END IF; END $do$;`);
    } catch { /* already exists / another worker won */ }
  }
}

export async function ensureFlowVersion(opts: { orgId: string; flowId: string; definition: unknown; userId?: string }) {
  const hash = definitionHash(opts.definition);
  const exact = await queryOne<{ id: string }>(`SELECT id FROM flow_versions WHERE flow_id=$1 AND definition_hash=$2`, [opts.flowId, hash]);
  if (exact) return exact.id;

  const last = await queryOne<{ version_number: number }>(`SELECT version_number FROM flow_versions WHERE flow_id=$1 ORDER BY version_number DESC LIMIT 1`, [opts.flowId]);
  const next = (last?.version_number ?? 0) + 1;
  await query(
    `INSERT INTO flow_versions (org_id, flow_id, definition, definition_hash, version_number, published_by)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (flow_id, definition_hash) DO NOTHING`,
    [opts.orgId, opts.flowId, JSON.stringify(opts.definition), hash, next, opts.userId ?? null],
  );
  const inserted = await queryOne<{ id: string }>(`SELECT id FROM flow_versions WHERE flow_id=$1 AND definition_hash=$2`, [opts.flowId, hash]);
  if (!inserted) throw new Error("FLOW_VERSION_CREATE_FAILED");
  return inserted.id;
}

export async function loadConnectionSecret(connectionId: string | null | undefined, orgId: string) {
  if (!connectionId) return null;
  try {
    const { ensureFreshToken } = await import("./oauth-refresh");
    const piece = await queryOne<{ piece_name: string }>(`SELECT piece_name FROM connections WHERE id=$1 AND org_id=$2`, [connectionId, orgId]);
    const fresh = await ensureFreshToken(connectionId, orgId, piece?.piece_name ?? "");
    if (fresh) return fresh;
  } catch { /* fall through */ }
  const row = await queryOne<{ ciphertext: Buffer | null; encrypted_payload: unknown }>(`SELECT ciphertext, encrypted_payload FROM connections WHERE id=$1 AND org_id=$2`, [connectionId, orgId]);
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
  const buf = encryptJson(credentials, orgId); return { ciphertext: buf, encrypted_payload: { _enc: buf.toString("base64") } };
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

function children(graph: WorkflowGraph, nodeId: string, handle?: string | null) {
  return graph.edges.filter((e) => e.source === nodeId && (handle == null || e.sourceHandle === handle)).map((e) => graph.nodes.find((n) => n.id === e.target)).filter((n): n is WorkflowGraph["nodes"][number] => Boolean(n));
}

function resolveStepInput(node: WorkflowGraph["nodes"][number], ctx: { trigger: Record<string, unknown>; steps: Record<string, Record<string, unknown>>; vars?: Record<string, unknown>; item?: unknown }) {
  return resolveValue({ ...(node.config ?? {}) }, { trigger: ctx.trigger ?? {}, steps: ctx.steps, vars: ctx.vars ?? {}, item: ctx.item }) as Record<string, unknown>;
}

function compareCondition(operator: string, left: unknown, right: unknown): boolean {
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
  const left = resolveValue(cfg.left, { trigger: ctx.trigger, steps: ctx.steps, vars: ctx.vars ?? {}, item: ctx.item });
  const right = resolveValue(cfg.right, { trigger: ctx.trigger, steps: ctx.steps, vars: ctx.vars ?? {}, item: ctx.item });
  return compareCondition(String(cfg.operator ?? "equals"), left, right);
}

async function executeNode(opts: {
  node: WorkflowGraph["nodes"][number];
  ctx: { trigger: Record<string, unknown>; steps: Record<string, Record<string, unknown>>; vars?: Record<string, unknown>; item?: unknown };
  orgId: string;
  runId: string;
  graph?: WorkflowGraph;
  allowSamples?: boolean;
}) {
  const { node, ctx, orgId, runId } = opts;
  if (node.type === "trigger" || !node.operation) return { ok: true as const, output: { ...(ctx.trigger ?? {}), appSlug: node.appSlug, operation: node.operation }, input: { ...(node.config ?? {}) } as Record<string, unknown> };
  const app = getApp(node.appSlug); const op = app?.operations.find((o) => o.key === node.operation);
  const auth = await loadConnectionSecret(node.connectionId, orgId);
  const input = resolveStepInput(node, ctx);
  if (node.appSlug === "aggregator") { input.__nodeId = node.id; input.__steps = ctx.steps; if (opts.graph) input.__graph = { nodes: opts.graph.nodes.map((n) => ({ id: n.id })), edges: opts.graph.edges.map((e) => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle })) }; }
  try {
    const result = await runAdapter({ appSlug: node.appSlug, operation: node.operation, input, auth, workspaceId: orgId, executionId: runId, connectionId: node.connectionId ?? undefined });
    return { ok: true as const, output: result.output ?? {}, input };
  } catch (err) {
    if (opts.allowSamples && op?.outputSample && /No live adapter/.test(err instanceof Error ? err.message : "")) return { ok: true as const, output: { ...(op.outputSample as Record<string, unknown>), _sample: true }, input };
    throw err;
  }
}

type GraphCtx = { trigger: Record<string, unknown>; steps: Record<string, Record<string, unknown>>; vars: Record<string, unknown>; item?: unknown };

/** Execute the active builder path. The graph is still the authoring format, but
 * control-flow decisions are interpreted explicitly; we never DFS every outgoing
 * edge of a branch/router as if all edges were sequential actions. */
async function executeGraph(opts: { graph: WorkflowGraph; startId: string; targetId?: string; ctx: GraphCtx; orgId: string; runId: string; allowSamples?: boolean; stopAfterTarget?: boolean; visited?: Set<string>; onStep?: (node: WorkflowGraph["nodes"][number], result: { output: Record<string, unknown>; input: Record<string, unknown> }) => Promise<void> }): Promise<{ reachedTarget: boolean }> {
  const { graph, startId, targetId, ctx, orgId, runId } = opts;
  const visited = opts.visited ?? new Set<string>();
  const node = graph.nodes.find((n) => n.id === startId);
  if (!node) return { reachedTarget: false };
  if (targetId && node.id === targetId) return { reachedTarget: true };
  if (visited.has(node.id)) return { reachedTarget: false };
  visited.add(node.id);

  if (node.type === "trigger") {
    const next = children(graph, node.id);
    for (const child of next) { const r = await executeGraph({ ...opts, startId: child.id, visited }); if (r.reachedTarget) return r; }
    return { reachedTarget: false };
  }

  if (node.appSlug === "filter") {
    if (!graphCondition(node, ctx)) return { reachedTarget: false };
  }

  if (node.appSlug === "paths" && node.operation === "branch") {
    const handle = graphCondition(node, ctx) ? "true" : "false";
    const next = children(graph, node.id, handle);
    for (const child of next) { const r = await executeGraph({ ...opts, startId: child.id, visited }); if (r.reachedTarget) return r; }
    return { reachedTarget: false };
  }

  if (node.appSlug === "paths") {
    // Router definitions may provide explicit path conditions in config.paths.
    // Otherwise the first configured path is used and path-b is the default.
    const cfg = node.config ?? {};
    const paths = Array.isArray(cfg.paths) ? cfg.paths as Array<{ id?: string; handle?: string; condition?: Record<string, unknown>; default?: boolean }> : [];
    let handle: string | null = null;
    for (const path of paths) {
      const pass = path.condition ? compareCondition(String(path.condition.operator ?? "equals"), resolveValue(path.condition.left, ctx), resolveValue(path.condition.right, ctx)) : false;
      if (pass) { handle = String(path.handle ?? path.id ?? "path-a"); break; }
    }
    if (!handle) handle = String(paths.find((p) => p.default)?.handle ?? paths.find((p) => p.default)?.id ?? "path-b");
    let next = children(graph, node.id, handle);
    if (!next.length) next = children(graph, node.id).filter((n) => n.id === targetId);
    for (const child of next) { const r = await executeGraph({ ...opts, startId: child.id, visited }); if (r.reachedTarget) return r; }
    return { reachedTarget: false };
  }

  if (node.appSlug === "loop") {
    const input = resolveStepInput(node, ctx); const items = Array.isArray(input.items) ? input.items : [];
    const next = children(graph, node.id);
    for (let i = 0; i < items.length; i++) {
      const loopCtx = { ...ctx, item: items[i], vars: { ...ctx.vars, loop: { item: items[i], index: i, total: items.length } } };
      for (const child of next) { const r = await executeGraph({ ...opts, startId: child.id, ctx: loopCtx, visited: new Set<string>() }); if (r.reachedTarget) return r; }
    }
    return { reachedTarget: false };
  }

  const result = await executeNode({ node, ctx, orgId, runId, graph, allowSamples: opts.allowSamples });
  ctx.steps[node.id] = result.output;
  await opts.onStep?.(node, { output: result.output, input: result.input });
  if (targetId && node.id === targetId) return { reachedTarget: true };

  const next = children(graph, node.id);
  for (const child of next) { const r = await executeGraph({ ...opts, startId: child.id, visited }); if (r.reachedTarget) return r; }
  return { reachedTarget: false };
}

export async function testFlowStep(opts: { orgId: string; flowId: string; nodeId: string; graph: unknown; inputs?: Record<string, unknown> }) {
  const graph = loadBuilderGraph(opts.graph); const node = graph.nodes.find((n) => n.id === opts.nodeId); if (!node) throw new Error("Step not found");
  const triggerNode = graph.nodes.find((n) => n.type === "trigger");
  const triggerSample = (triggerNode?.config?.sampleOutput ?? triggerNode?.config?.testData ?? {}) as Record<string, unknown>;
  const ctx: GraphCtx = { trigger: { ...triggerSample, ...(opts.inputs ?? {}) }, steps: {}, vars: {} };
  const started = Date.now();
  try {
    const result = await executeGraph({ graph, startId: triggerNode?.id ?? graph.nodes[0]?.id ?? opts.nodeId, targetId: opts.nodeId, ctx, orgId: opts.orgId, runId: `test:${opts.flowId}:${opts.nodeId}:${Date.now()}`, allowSamples: true });
    if (!result.reachedTarget) return { ok: false, output: undefined, error: "Unable to reach target step from trigger using the current workflow path", duration_ms: Date.now() - started, status: "failed" };
    return { ok: true, output: ctx.steps[opts.nodeId], error: undefined, duration_ms: Date.now() - started, status: "succeeded" };
  } catch (err) {
    return { ok: false, output: undefined, error: err instanceof Error ? err.message : "Step failed", duration_ms: Date.now() - started, status: "failed" };
  }
}

export async function createAndRunFlow(opts: {
  orgId: string; flowId: string; userId: string; payload?: Record<string, unknown>; graph?: unknown; triggerKind?: string;
  eventId?: string | null; idempotencyKey?: string | null; receivedAt?: string; replaySteps?: Record<string, Record<string, unknown>>;
  onStepComplete?: (step: { stepId: string; status: string; output?: unknown; error?: string; durationMs?: number }) => void;
}) {
  await ensureRunPartition();
  const flow = await queryOne<{ id: string; project_id: string; draft_definition: unknown; published_version_id: string | null }>(`SELECT id, project_id, draft_definition, published_version_id FROM flows WHERE id=$1 AND org_id=$2`, [opts.flowId, opts.orgId]);
  if (!flow) throw new Error("Flow not found");

  const mode = opts.triggerKind === "test" || opts.triggerKind === "manual_test" ? "test" : "production";
  let definition: any;
  let versionId: string;
  if (mode === "production") {
    if (!flow.published_version_id) throw new Error("FLOW_NOT_PUBLISHED");
    const version = await queryOne<{ id: string; definition: unknown }>(`SELECT id, definition FROM flow_versions WHERE id=$1 AND flow_id=$2`, [flow.published_version_id, flow.id]);
    if (!version) throw new Error("PUBLISHED_FLOW_VERSION_NOT_FOUND");
    versionId = version.id; definition = version.definition;
  } else {
    definition = persistBuilderDraft(opts.graph ?? loadBuilderGraph(flow.draft_definition));
    versionId = await ensureFlowVersion({ orgId: opts.orgId, flowId: flow.id, definition, userId: opts.userId });
  }
  const graph = loadBuilderGraph(definition);
  const triggerEnvelope = buildTriggerEnvelope({ workspaceId: opts.orgId, organizationId: opts.orgId, automationId: flow.id, versionId, triggerType: opts.triggerKind ?? "test", payload: opts.payload ?? { ping: true }, eventId: opts.eventId, idempotencyKey: opts.idempotencyKey, receivedAt: opts.receivedAt });

  let projectId = flow.project_id;
  if (!projectId) {
    const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE org_id=$1 LIMIT 1`, [opts.orgId]);
    projectId = proj?.id;
    if (!projectId) { const created = await queryOne<{ id: string }>(`INSERT INTO projects (org_id,name,slug) VALUES ($1,'Default','default') RETURNING id`, [opts.orgId]); projectId = created!.id; }
    await query(`UPDATE flows SET project_id=$1 WHERE id=$2`, [projectId, flow.id]);
  }

  const claimed = await withTransaction(async (client) => {
    if (triggerEnvelope.idempotencyKey) {
      const claim = await client.query<{ flow_run_id: string | null }>(
        `INSERT INTO trigger_events (org_id,workspace_id,automation_id,version_id,event_id,trigger_type,received_at,idempotency_key,payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (org_id,idempotency_key) DO NOTHING RETURNING flow_run_id`,
        [opts.orgId, opts.orgId, flow.id, versionId, triggerEnvelope.eventId, triggerEnvelope.triggerType, triggerEnvelope.receivedAt, triggerEnvelope.idempotencyKey, JSON.stringify(triggerEnvelope.payload)],
      );
      if (!claim.rows[0]) {
        const existing = await client.query<{ flow_run_id: string | null }>(`SELECT flow_run_id FROM trigger_events WHERE org_id=$1 AND idempotency_key=$2 FOR UPDATE`, [opts.orgId, triggerEnvelope.idempotencyKey]);
        if (existing.rows[0]?.flow_run_id) return { duplicate: true, id: existing.rows[0].flow_run_id };
        throw new Error("TRIGGER_EVENT_CLAIM_INCOMPLETE");
      }
    }
    const inserted = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO flow_runs (org_id,project_id,flow_id,flow_version_id,trigger_kind,trigger_event_id,idempotency_key,status,context)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'running',$8) RETURNING id,created_at`,
      [opts.orgId, projectId, flow.id, versionId, triggerEnvelope.triggerType, triggerEnvelope.eventId, triggerEnvelope.idempotencyKey, JSON.stringify({ trigger: triggerEnvelope.payload })],
    );
    const created = inserted.rows[0]; if (!created) throw new Error("Failed to create execution run record.");
    if (triggerEnvelope.idempotencyKey) await client.query(`UPDATE trigger_events SET flow_run_id=$1 WHERE org_id=$2 AND idempotency_key=$3`, [created.id, opts.orgId, triggerEnvelope.idempotencyKey]);
    return { duplicate: false, id: created.id };
  });
  if (claimed.duplicate) return { id: claimed.id, duplicate: true };

  const runId = claimed.id;
  const exact = await queryOne<{ created_at: string }>(`SELECT created_at::text AS created_at FROM flow_runs WHERE id=$1`, [runId]);
  const runCreatedAt = exact?.created_at ?? new Date().toISOString();
  const ctx: GraphCtx = { trigger: triggerEnvelope.payload, steps: {}, vars: {} };
  if (opts.replaySteps) for (const [stepId, output] of Object.entries(opts.replaySteps)) ctx.steps[stepId] = output;

  let seq = 0; let failed: string | null = null; let handledError = false;
  const persistStep = async (node: WorkflowGraph["nodes"][number], status: string, input: unknown, output?: unknown, error?: string) => {
    seq += 1;
    await query(
      `INSERT INTO run_steps (run_id,run_created_at,org_id,step_id,step_type,sequence_no,status,input_json,output_json,error_json,started_at,finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())`,
      [runId, runCreatedAt, opts.orgId, node.id, stepTypeOf(node), seq, status, JSON.stringify(redact(input ?? {})), output === undefined ? null : JSON.stringify(redact(output)), error ? JSON.stringify({ message: error }) : null],
    );
  };

  const onStep = async (node: WorkflowGraph["nodes"][number], result: { output: Record<string, unknown>; input: Record<string, unknown> }) => {
    if (opts.replaySteps && node.id in opts.replaySteps) return;
    await persistStep(node, "succeeded", result.input, result.output);
    opts.onStepComplete?.({ stepId: node.id, status: "succeeded", output: result.output });
  };

  try {
    const trigger = graph.nodes.find((n) => n.type === "trigger");
    if (!trigger) throw new Error("WORKFLOW_TRIGGER_MISSING");
    if (opts.replaySteps) for (const [stepId, output] of Object.entries(opts.replaySteps)) { const n = graph.nodes.find((x) => x.id === stepId); if (n) await persistStep(n, "succeeded", n.config ?? {}, output); }
    const result = await executeGraph({ graph, startId: trigger.id, ctx, orgId: opts.orgId, runId, allowSamples: false, onStep });
    if (!result.reachedTarget && graph.nodes.length > 1) {
      // reachedTarget is only meaningful when a target is supplied; the normal
      // execution walker still completed all active reachable nodes here.
    }
  } catch (err) {
    failed = err instanceof Error ? err.message : "step_failed";
    opts.onStepComplete?.({ stepId: "workflow", status: "failed", error: failed });
  }

  const finalStatus = failed ? "failed" : handledError ? "handled_error" : "succeeded";
  await query(`UPDATE flow_runs SET status=$2,finished_at=now(),context=$3,steps_billable=$4 WHERE id=$1 AND org_id=$5`, [runId, finalStatus, JSON.stringify(ctx), Math.max(0, seq), opts.orgId]);
  return { id: runId };
}

export function mapRunToExecution(row: Record<string, unknown>, steps: Array<Record<string, unknown>> = []) {
  const firstFailed = steps.find((s) => s.status === "failed");
  const runError = typeof firstFailed?.error_json === "object" && firstFailed?.error_json ? firstFailed.error_json : firstFailed?.error_json ? { message: String(firstFailed.error_json) } : { message: "Run failed" };
  return {
    execution: { id: row.id, status: row.status, automation_name: row.flow_name, automation_id: row.flow_id, trigger_type: row.trigger_kind, created_at: row.created_at, finished_at: row.finished_at, error: row.status === "failed" ? runError : undefined },
    steps: steps.map((s) => ({ id: s.id, step_id: s.step_id, name: s.step_id, status: s.status, duration_ms: s.duration_ms, error: typeof s.error_json === "object" && s.error_json ? s.error_json : s.error_json ? { message: String(s.error_json) } : undefined, output: s.output_json, input: s.input_json, app_slug: s.step_type })),
    logs: [],
  };
}
