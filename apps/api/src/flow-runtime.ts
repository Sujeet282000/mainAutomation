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
  // Create partitions for current and next month to be safe
  const months = [new Date()];
  const nextMonth = new Date();
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  months.push(nextMonth);

  for (const date of months) {
    const start = new Date(date);
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const name = `flow_runs_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    const startStr = start.toISOString().replace("T", " ").replace(".000Z", "");
    const endStr = end.toISOString().replace("T", " ").replace(".000Z", "");
    try {
      await query(
        `CREATE TABLE IF NOT EXISTS public."${name}" PARTITION OF public.flow_runs FOR VALUES FROM ($1) TO ($2)`,
        [startStr, endStr],
      );
      // Partition creation materializes the parent's indexes under auto-generated
      // names (…_key). Only add our named copy when it doesn't already exist, so
      // re-running this never stacks duplicate indexes on the partition.
      await query(`
        DO $do$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = '${name}'
              AND indexdef LIKE '%(id, created_at, org_id)%'
          ) THEN
            EXECUTE 'CREATE UNIQUE INDEX "${name}_id_created_at_org_id_idx" ON public."${name}" (id, created_at, org_id)';
          END IF;
        END
        $do$;
      `);
    } catch {
      // Partition may already exist — continue
    }
  }
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
  // OAuth connections get proactive token refresh here — executions and step
  // tests always see a valid access token (or a needs_attention connection).
  try {
    const { ensureFreshToken } = await import("./oauth-refresh");
    const piece = await queryOne<{ piece_name: string }>(
      `SELECT piece_name FROM connections WHERE id = $1 AND org_id = $2`,
      [connectionId, orgId],
    );
    const fresh = await ensureFreshToken(connectionId, orgId, piece?.piece_name ?? "");
    if (fresh) return fresh;
  } catch {
    /* fall through to plain load */
  }
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

/** Resolve {{...}} step mappings the same way the canonical engine does — raw
 *  templates must never reach a provider API (a literal "{{trigger.row[0]}}"
 *  used to be sent to Google Calendar and fail with an opaque 400). */
function resolveStepInput(
  node: WorkflowGraph["nodes"][number],
  ctx: { trigger: Record<string, unknown>; steps: Record<string, Record<string, unknown>>; vars?: Record<string, unknown>; item?: unknown },
) {
  return resolveValue({ ...(node.config ?? {}) }, {
    trigger: ctx.trigger ?? {},
    steps: ctx.steps,
    vars: ctx.vars ?? {},
    item: ctx.item,
  }) as Record<string, unknown>;
}

async function executeNode(opts: {
  node: WorkflowGraph["nodes"][number];
  ctx: { trigger: Record<string, unknown>; steps: Record<string, Record<string, unknown>>; vars?: Record<string, unknown>; item?: unknown };
  orgId: string;
  runId: string;
  graph?: WorkflowGraph;
}) {
  const { node, ctx, orgId, runId } = opts;
  if (node.type === "trigger" || !node.operation) {
    return { ok: true as const, output: { ...(ctx.trigger ?? {}), appSlug: node.appSlug, operation: node.operation }, input: { ...(node.config ?? {}) } as Record<string, unknown> };
  }
  const app = getApp(node.appSlug);
  const op = app?.operations.find((o) => o.key === node.operation);
  const auth = await loadConnectionSecret(node.connectionId, orgId);
  const input = resolveStepInput(node, ctx);
  // Fan-in nodes (aggregator) receive the live graph + step outputs so they
  // can merge their incoming branches. Underscore-prefixed keys are engine
  // context, never part of the user-visible config.
  if (node.appSlug === "aggregator") {
    input.__nodeId = node.id;
    input.__steps = ctx.steps;
    if (opts.graph) {
      input.__graph = { nodes: opts.graph.nodes.map((n) => ({ id: n.id })), edges: opts.graph.edges.map((e) => ({ source: e.source, target: e.target })) };
    }
  }
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
    return { ok: true as const, output: result.output ?? {}, input };
  } catch (err) {
    if (op?.outputSample && /No live adapter/.test(err instanceof Error ? err.message : "")) {
      return { ok: true as const, output: { ...(op.outputSample as Record<string, unknown>), _sample: true }, input };
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
  try {
    const result = await executeNode({ node, ctx, orgId: opts.orgId, runId: opts.flowId, graph });
    return { ok: true, output: result.output, error: undefined, duration_ms: Date.now() - started, status: "succeeded" };
  } catch (err) {
    return {
      ok: false,
      output: undefined,
      error: err instanceof Error ? err.message : "Step failed",
      duration_ms: Date.now() - started,
      status: "failed",
    };
  }
}

export async function createAndRunFlow(opts: {
  orgId: string;
  flowId: string;
  userId: string;
  payload?: Record<string, unknown>;
  graph?: unknown;
  triggerKind?: string;
  eventId?: string | null;
  idempotencyKey?: string | null;
  receivedAt?: string;
  /** Replay-from-step: seed these step outputs into context so upstream steps never re-run. */
  replaySteps?: Record<string, Record<string, unknown>>;
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
  const triggerEnvelope = buildTriggerEnvelope({
    workspaceId: opts.orgId,
    organizationId: opts.orgId,
    automationId: flow.id,
    versionId,
    triggerType: opts.triggerKind ?? "test",
    payload: opts.payload ?? { ping: true },
    eventId: opts.eventId,
    idempotencyKey: opts.idempotencyKey,
    receivedAt: opts.receivedAt,
  });
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
  const run = await withTransaction(async (client) => {
    if (triggerEnvelope.idempotencyKey) {
      const claim = await client.query<{ flow_run_id: string | null }>(
        `INSERT INTO trigger_events
          (org_id, workspace_id, automation_id, version_id, event_id, trigger_type, received_at, idempotency_key, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (org_id, idempotency_key) DO NOTHING
         RETURNING flow_run_id`,
        [opts.orgId, opts.orgId, flow.id, versionId, triggerEnvelope.eventId, triggerEnvelope.triggerType, triggerEnvelope.receivedAt, triggerEnvelope.idempotencyKey, JSON.stringify(triggerEnvelope.payload)],
      );
      if (!claim.rows[0]) {
        const existing = await client.query<{ flow_run_id: string | null }>(
          `SELECT flow_run_id FROM trigger_events WHERE org_id=$1 AND idempotency_key=$2 FOR UPDATE`,
          [opts.orgId, triggerEnvelope.idempotencyKey],
        );
        if (existing.rows[0]?.flow_run_id) return { id: existing.rows[0].flow_run_id, created_at: new Date() };
        throw new Error("TRIGGER_EVENT_CLAIM_INCOMPLETE");
      }
    }

    const inserted = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO flow_runs (org_id, project_id, flow_id, flow_version_id, trigger_kind, trigger_event_id, idempotency_key, status, context)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'running',$8) RETURNING id, created_at`,
      [opts.orgId, projectId, flow.id, versionId, triggerEnvelope.triggerType, triggerEnvelope.eventId, triggerEnvelope.idempotencyKey, JSON.stringify({ trigger: triggerEnvelope.payload })],
    );
    const created = inserted.rows[0];
    if (!created) throw new Error("Failed to create execution run record.");
    if (triggerEnvelope.idempotencyKey) {
      await client.query(
        `UPDATE trigger_events SET flow_run_id=$1 WHERE org_id=$2 AND idempotency_key=$3`,
        [created.id, opts.orgId, triggerEnvelope.idempotencyKey],
      );
    }
    return created;
  });
  if (!run) throw new Error("Failed to create execution run record.");
  // run_steps.run_created_at must equal flow_runs.created_at exactly — the FK
  // targets the monthly partition keyed on (run_id, created_at, org_id), and a
  // JS round-trip drops microseconds so the value never matches. Fetch the
  // exact stored timestamp from PostgreSQL instead of trusting RETURNING.
  const exact = await queryOne<{ created_at: string }>(
    `SELECT created_at::text AS created_at FROM flow_runs WHERE id = $1`,
    [run.id],
  );
  const runCreatedAt = exact?.created_at ?? String(run.created_at);
  const ctx: { trigger: Record<string, unknown>; steps: Record<string, Record<string, unknown>>; vars: Record<string, unknown>; item?: unknown } = { trigger: triggerEnvelope.payload, steps: {}, vars: {} };
  // Replay-from-step: previously-succeeded step outputs are pre-seeded so the
  // walk marks them done and only downstream steps actually execute.
  if (opts.replaySteps) {
    for (const [stepId, output] of Object.entries(opts.replaySteps)) {
      ctx.steps[stepId] = output;
    }
  }
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
    // Replay-from-step: pre-seeded steps are recorded as succeeded without executing.
    if (opts.replaySteps && node.id in opts.replaySteps) {
      const seeded = ctx.steps[node.id];
      await query(
        `INSERT INTO run_steps (run_id, run_created_at, org_id, step_id, step_type, sequence_no, status, input_json, output_json, started_at, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,'succeeded',$7,$8,now(),now())`,
        [
          run!.id,
          runCreatedAt,
          opts.orgId,
          node.id,
          stepTypeOf(node),
          seq,
          JSON.stringify(redact(node.config ?? {})),
          JSON.stringify(seeded),
        ],
      );
      opts.onStepComplete?.({ stepId: node.id, status: "succeeded", output: seeded, durationMs: 0 });
      continue;
    }
    try {
      const result = await executeNode({ node, ctx, orgId: opts.orgId, runId: run!.id, graph });
      ctx.steps[node.id] = result.output;
      // Persist the RESOLVED input ({{...}} templates already substituted) —
      // the run explorer shows what actually reached the provider, so a bad
      // mapping like To=row[0] is visible in the step input immediately.
      await query(
        `INSERT INTO run_steps (run_id, run_created_at, org_id, step_id, step_type, sequence_no, status, input_json, output_json, started_at, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,'succeeded',$7,$8,now(),now())`,
        [
          run!.id,
          runCreatedAt,
          opts.orgId,
          node.id,
          stepTypeOf(node),
          seq,
          JSON.stringify(redact(result.input ?? node.config ?? {})),
          JSON.stringify(result.output),
        ],
      );
      opts.onStepComplete?.({ stepId: node.id, status: "succeeded", output: result.output, durationMs: Date.now() - started.getTime() });
    } catch (err) {
      failed = err instanceof Error ? err.message : "step_failed";
      // Persist the resolved input on failure too — for steps that throw in
      // resolveValue itself (bad template path) the resolved input is whatever
      // substituted before the throw; otherwise it mirrors the provider call.
      let failedInput: Record<string, unknown> = {};
      try {
        failedInput = resolveStepInput(node, ctx);
      } catch {
        failedInput = { ...(node.config ?? {}) } as Record<string, unknown>;
      }
      await query(
        `INSERT INTO run_steps (run_id, run_created_at, org_id, step_id, step_type, sequence_no, status, input_json, error_json, started_at, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,'failed',$7,$8,now(),now())`,
        [
          run!.id,
          runCreatedAt,
          opts.orgId,
          node.id,
          stepTypeOf(node),
          seq,
          JSON.stringify(redact(failedInput)),
          JSON.stringify({ message: failed }),
        ],
      );
      opts.onStepComplete?.({ stepId: node.id, status: "failed", error: failed, durationMs: Date.now() - started.getTime() });
      // Per-step error policy — mirrors the canonical engine: a step with
      // onError continue/fallback records the failure but keeps the run going
      // (auth failures always stop; a broken connection can't be papered over).
      const policy = parseErrorPolicy((node.config ?? {}).onError) ?? "stop";
      if (!isAuthError(err) && policy !== "stop") {
        const fallbackValue = policy === "fallback"
          ? resolveValue((node.config ?? {}).fallbackValue, { trigger: ctx.trigger, steps: ctx.steps, vars: ctx.vars ?? {}, item: ctx.item })
          : { error: failed };
        ctx.steps[node.id] = typeof fallbackValue === "object" && fallbackValue !== null
          ? (fallbackValue as Record<string, unknown>)
          : { error: failed };
        failed = null; // the run itself is no longer failing
        continue;
      }
      break;
    }
  }

  // The run-level error surfaces from the first failed step's error_json
  // (see mapRunToExecution) — never a generic "Run failed".
  const finalStatus = failed ? "failed" : "succeeded";
  await query(
    `UPDATE flow_runs SET status = $2, finished_at = now(), context = $3, steps_billable = $4 WHERE id = $1 AND org_id = $5`,
    [run!.id, finalStatus, JSON.stringify(ctx), Math.max(0, seq - 1), opts.orgId],
  );
  return { id: run!.id };
}

export function mapRunToExecution(row: Record<string, unknown>, steps: Array<Record<string, unknown>> = []) {
  // Surface the real first-failed-step message on the run — the legacy
  // generic "Run failed" gave users nothing to act on.
  const firstFailed = steps.find((s) => s.status === "failed");
  const runError = typeof firstFailed?.error_json === "object" && firstFailed?.error_json
    ? firstFailed.error_json
    : firstFailed?.error_json
      ? { message: String(firstFailed.error_json) }
      : { message: "Run failed" };
  return {
    execution: {
      id: row.id,
      status: row.status,
      automation_name: row.flow_name,
      automation_id: row.flow_id,
      trigger_type: row.trigger_kind,
      created_at: row.created_at,
      finished_at: row.finished_at,
      error: row.status === "failed" ? runError : undefined,
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
