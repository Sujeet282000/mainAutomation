import { normalizeWorkflowGraph, type WorkflowGraph, type GraphNode } from "@algoverge/shared";
import { resolveValue } from "@algoverge/core";
import { runAdapter } from "./adapters";
import { getApp } from "./catalog/catalog";
import { loadConnectionAuth } from "./connections";
import { redact } from "./crypto";
import { query, queryOne } from "./db";
import { recordUsage, taskUnitsForStep } from "./metering";
import { enqueueExecution } from "./queue";
import { isAuthError, missingRequiredMappings, shouldPauseAfterFailures, StepError } from "./runtime-guards";

type Ctx = {
  trigger: Record<string, unknown>;
  steps: Record<string, Record<string, unknown>>;
  item?: unknown;
  vars: Record<string, unknown>;
  resumeAfterNodeId?: string;
};

async function loadAuth(connectionId: string | null | undefined, workspaceId: string) {
  return loadConnectionAuth(connectionId, workspaceId);
}

function children(graph: WorkflowGraph, nodeId: string, handle?: string | null) {
  return graph.edges
    .filter((e) => {
      if (e.source !== nodeId) return false;
      if (!handle) return true;
      return e.sourceHandle === handle;
    })
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter((n): n is GraphNode => Boolean(n));
}

function findTrigger(graph: WorkflowGraph) {
  return graph.nodes.find((n) => n.type === "trigger") ?? graph.nodes[0];
}

export async function createExecution(opts: {
  automationId: string;
  triggerType: string;
  triggerData: Record<string, unknown>;
  idempotencyKey?: string;
  versionId?: string | null;
  /** Manual builder tests are executed by the API so they work without a worker. */
  enqueue?: boolean;
}) {
  const auto = await queryOne<{
    id: string;
    organization_id: string;
    workspace_id: string;
    published_version_id: string | null;
    current_version_id: string | null;
    status: string;
  }>(`select * from automations where id=$1`, [opts.automationId]);
  if (!auto) throw new Error("Automation not found");
  if (auto.status === "paused") throw new Error("Automation is paused after repeated failures. Turn it on after fixing the error.");
  if (opts.idempotencyKey) {
    const existing = await queryOne(`select id from executions where workspace_id=$1 and idempotency_key=$2`, [
      auto.workspace_id,
      opts.idempotencyKey
    ]);
    if (existing) return existing;
  }
  const exec = await queryOne<{ id: string }>(
    `insert into executions (organization_id, workspace_id, automation_id, version_id, trigger_type, trigger_event_id, idempotency_key, status, context)
     values ($1,$2,$3,$4,$5,$6,$7,'queued',$8) returning id`,
    [
      auto.organization_id,
      auto.workspace_id,
      auto.id,
      opts.versionId ?? auto.published_version_id ?? auto.current_version_id,
      opts.triggerType,
      (opts.triggerData.id as string) ?? null,
      opts.idempotencyKey ?? null,
      JSON.stringify({ trigger: opts.triggerData })
    ]
  );
  await query(`insert into usage_records (organization_id, workspace_id, metric, quantity) values ($1,$2,'executions',1)`, [
    auto.organization_id,
    auto.workspace_id
  ]);
  if (opts.enqueue !== false) {
    await enqueueExecution({ executionId: exec!.id, workspaceId: auto.workspace_id, orgId: auto.organization_id });
  }
  return exec!;
}

export async function retryExecution(executionId: string, workspaceId: string) {
  const exec = await queryOne<{
    automation_id: string;
    trigger_type: string;
    version_id: string | null;
    context: { trigger?: Record<string, unknown> };
  }>(`select * from executions where id=$1 and workspace_id=$2`, [executionId, workspaceId]);
  if (!exec) throw new Error("Execution not found");
  return createExecution({
    automationId: exec.automation_id,
    triggerType: exec.trigger_type || "manual",
    triggerData: exec.context?.trigger ?? { retryOf: executionId },
    versionId: exec.version_id
  });
}

export async function runExecution(executionId: string) {
  const exec = await queryOne<{
    id: string;
    workspace_id: string;
    organization_id: string;
    automation_id: string;
    version_id: string | null;
    context: Ctx;
    status: string;
    trigger_type: string;
  }>(`select * from executions where id=$1`, [executionId]);
  if (!exec) throw new Error("missing execution");
  if (exec.status === "cancelled") return;

  const version = exec.version_id
    ? await queryOne<{ graph: WorkflowGraph }>(`select graph from automation_versions where id=$1`, [exec.version_id])
    : await queryOne<{ graph: WorkflowGraph }>(
        `select graph from automation_versions where automation_id=$1 order by version_number desc limit 1`,
        [exec.automation_id]
      );
  if (!version) throw new Error("No automation version");
  const graph = normalizeWorkflowGraph(version.graph);
  const triggerNode = findTrigger(graph);
  const varRows = await query<{ key: string; value: string }>(
    `select key, value from workspace_variables where workspace_id=$1`,
    [exec.workspace_id]
  );
  const vars: Record<string, unknown> = { ...(exec.context?.vars ?? {}) };
  for (const v of varRows) vars[v.key] = v.value;
  const ctx: Ctx = {
    trigger: exec.context?.trigger ?? {},
    steps: exec.context?.steps ?? {},
    vars,
    resumeAfterNodeId: exec.context?.resumeAfterNodeId
  };

  await query(`update executions set status='running', started_at=coalesce(started_at, now()) where id=$1`, [executionId]);
  try {
    if (ctx.resumeAfterNodeId) {
      const node = graph.nodes.find((n) => n.id === ctx.resumeAfterNodeId);
      if (!node) throw new Error("Resume node missing from graph");
      const resumeId = ctx.resumeAfterNodeId;
      ctx.resumeAfterNodeId = undefined;
      const nexts = children(graph, resumeId);
      for (const n of nexts) {
        const r = await walk(graph, n, ctx, executionId, exec.workspace_id, exec.organization_id, exec.automation_id, exec.trigger_type, false);
        if (r === "wait") {
          return;
        }
      }
    } else {
      const r = await walk(graph, triggerNode, ctx, executionId, exec.workspace_id, exec.organization_id, exec.automation_id, exec.trigger_type, true);
      if (r === "wait") return;
    }
    await query(
      `update executions set status='succeeded', error=null, finished_at=now(), duration_ms=extract(epoch from (now()-started_at))*1000, context=$2 where id=$1`,
      [executionId, JSON.stringify(ctx)]
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    await query(`update executions set status='failed', finished_at=now(), error=$2::jsonb where id=$1`, [
      executionId,
      JSON.stringify({ message, code: err instanceof StepError ? err.code : undefined })
    ]);
    await maybeAutoPause(exec.automation_id, exec.workspace_id);
    throw err;
  }
}

async function maybeAutoPause(automationId: string, workspaceId: string) {
  const rows = await query<{ status: string }>(
    `select status from executions where automation_id=$1 and workspace_id=$2 order by created_at desc limit 5`,
    [automationId, workspaceId]
  );
  if (!shouldPauseAfterFailures(rows.map((r) => r.status))) return false;
  await query(
    `update automations set status='paused', settings = coalesce(settings, '{}'::jsonb) || $2::jsonb, updated_at=now()
     where id=$1 and status='on'`,
    [automationId, JSON.stringify({ pausedReason: "consecutive_failures", pausedAt: new Date().toISOString() })]
  );
  return true;
}

async function walk(
  graph: WorkflowGraph,
  node: GraphNode,
  ctx: Ctx,
  executionId: string,
  workspaceId: string,
  organizationId: string,
  automationId: string,
  triggerType: string,
  isTrigger: boolean
): Promise<"ok" | "skip" | "wait"> {
  const stepRow = await queryOne<{ id: string }>(
    `insert into execution_steps (execution_id, step_id, name, app_slug, operation, status, attempt, input)
     values ($1,$2,$3,$4,$5,'running',1,$6) returning id`,
    [executionId, node.id, node.label, node.appSlug, node.operation, JSON.stringify(node.config)]
  );
  const started = Date.now();
  try {
    if (!node.appSlug || !node.operation) {
      await query(
        `update execution_steps set status='succeeded', error=null, output=$2, finished_at=now(), duration_ms=$3 where id=$1`,
        [stepRow!.id, JSON.stringify({ skipped: "empty_placeholder" }), Date.now() - started]
      );
      const nexts = children(graph, node.id);
      for (const n of nexts) {
        const r = await walk(graph, n, ctx, executionId, workspaceId, organizationId, automationId, triggerType, false);
        if (r === "wait" || r === "skip") return r;
      }
      return "ok";
    }
    const resolved = resolveValue(node.config, {
      trigger: ctx.trigger,
      steps: ctx.steps,
      vars: ctx.vars,
      item: ctx.item
    }) as Record<string, unknown>;
    if (!isTrigger) {
      const missing = missingRequiredMappings(node.appSlug, node.operation, node.config ?? {}, resolved);
      if (missing.length) {
        throw new StepError(`Required field mapping missing: ${missing.join(", ")}`, {
          retryable: false,
          code: "mapping"
        });
      }
    }
    const app = getApp(node.appSlug);
    if (app && app.authType && app.authType !== "none" && !node.connectionId) {
      throw new StepError(`Step "${node.label}" has no connection_id. Connect the app before running.`, {
        retryable: false,
        code: "connection"
      });
    }
    const auth = await loadAuth(node.connectionId, workspaceId);
    const input = isTrigger ? { ...resolved, ...ctx.trigger } : resolved;
    const result = await runAdapter({
      appSlug: node.appSlug,
      operation: node.operation,
      input,
      auth,
      workspaceId,
      executionId,
      connectionId: node.connectionId ?? undefined,
      idempotencyKey: `${executionId}:${node.id}:${stepRow!.id}`
    });
    ctx.steps[node.id] = result.output;
    const billed = taskUnitsForStep({
      appSlug: node.appSlug,
      isTrigger,
      byok: Boolean(auth?.api_key),
      aiTier: String(input.tier ?? "standard"),
      mcp: triggerType === "mcp"
    });
    if (billed > 0) {
      await recordUsage({
        organizationId,
        workspaceId,
        metric: "tasks",
        quantity: billed,
        metadata: { executionId, stepId: node.id, appSlug: node.appSlug, operation: node.operation }
      });
      await recordUsage({
        organizationId,
        workspaceId,
        metric: "steps_billable",
        quantity: billed,
        metadata: { executionId, stepId: node.id }
      });
    }
    await query(
      `update execution_steps set status='succeeded', error=null, output=$2, finished_at=now(), duration_ms=$3 where id=$1`,
      [stepRow!.id, JSON.stringify(redact(result.output)), Date.now() - started]
    );
    await query(`insert into execution_logs (execution_id, step_id, level, message, data) values ($1,$2,'info',$3,$4)`, [
      executionId,
      node.id,
      `${node.label} succeeded`,
      JSON.stringify({ app: node.appSlug, operation: node.operation })
    ]);

    if (result.control === "skip_rest") return "skip";
    if (result.control === "wait") {
      ctx.resumeAfterNodeId = node.id;
      await query(`update executions set status='waiting', context=$2 where id=$1`, [executionId, JSON.stringify(ctx)]);
      if (!result.hold && result.waitMs && result.waitMs > 0 && result.waitMs < 7 * 24 * 3600 * 1000) {
        await enqueueExecution({ executionId, workspaceId, delayMs: result.waitMs, orgId: organizationId });
      }
      return "wait";
    }
    if (result.loopItems) {
      for (const item of result.loopItems) {
        ctx.item = item;
        const nexts = children(graph, node.id);
        for (const n of nexts) {
          const r = await walk(graph, n, ctx, executionId, workspaceId, organizationId, automationId, triggerType, false);
          if (r === "wait") return "wait";
        }
      }
      return "ok";
    }
    if (result.control === "branch") {
      const handle = result.branch === "true" ? "true" : "false";
      const nexts = children(graph, node.id, handle);
      for (const n of nexts) {
        const r = await walk(graph, n, ctx, executionId, workspaceId, organizationId, automationId, triggerType, false);
        if (r === "wait") return r;
      }
      return "ok";
    }
    if (result.control === "paths") {
      const handles = result.matchedHandles?.length ? result.matchedHandles : ["path-b"];
      for (const handle of handles) {
        for (const n of children(graph, node.id, handle)) {
          const r = await walk(graph, n, ctx, executionId, workspaceId, organizationId, automationId, triggerType, false);
          if (r === "wait") return r;
        }
      }
      return "ok";
    }
    if (node.appSlug === "subflow" && resolved.automationId) {
      await createExecution({
        automationId: String(resolved.automationId),
        triggerType: "subflow",
        triggerData: (resolved.payload as Record<string, unknown>) ?? { parentExecutionId: executionId }
      });
    }
    const nexts = children(graph, node.id);
    for (const n of nexts) {
          const r = await walk(graph, n, ctx, executionId, workspaceId, organizationId, automationId, triggerType, false);
      if (r === "wait" || r === "skip") return r;
    }
    return "ok";
  } catch (err) {
    const message = err instanceof Error ? err.message : "error";
    if (isAuthError(err) && node.connectionId) {
      await query(
        `update connections set status='error', error_code='needs_reconnect', updated_at=now()
         where id=$1 and org_id=$2`,
        [node.connectionId, workspaceId]
      );
    }
    await query(
      `update execution_steps set status='failed', error=$2::jsonb, finished_at=now(), duration_ms=$3
       where id=$1 and status='running'`,
      [stepRow!.id, JSON.stringify({ message }), Date.now() - started]
    );
    if (isAuthError(err)) {
      throw new StepError(message, { retryable: false, code: "auth" });
    }
    throw err;
  }
}

export async function findPublishedByTrigger(appSlug: string, operation: string) {
  return query<{ id: string; workspace_id: string }>(
    `select a.id, a.workspace_id
     from automations a
     join automation_versions v on v.id = a.published_version_id
     where a.status = 'on' and a.deleted_at is null
       and exists (
         select 1 from jsonb_array_elements(v.graph->'nodes') n
         where n->>'type' = 'trigger' and n->>'appSlug' = $1 and n->>'operation' = $2
       )`,
    [appSlug, operation]
  );
}
