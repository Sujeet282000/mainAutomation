import type { Router, Request, Response } from "express";
import { z } from "zod";
import { coerceWorkflowGraph } from "@algoverge/core";
import { normalizeWorkflowGraph } from "@algoverge/shared";
import { APP_CATALOG, getApp, listCatalogApps } from "./catalog/catalog";
import { authSchemaForSlug, credentialShapeError, validateAuthCredentials } from "./auth-schema";
import { getDynamicFieldsHandler } from "./adapters";
import { query, queryOne } from "./db";
import { persistBuilderDraft, persistBuilderDraftLenient, loadBuilderGraph, createAndRunFlow, testFlowStep, mapRunToExecution, resolveStepNames, resolveNodeIds, sealConnectionSecret, loadConnectionSecret } from "./flow-runtime";
import { validateWorkflowGraph } from "./workflow-validation";
import { copilotGraph, copilotChat } from "./copilot/copilot";
import { runCopilotEngine } from "./copilot/copilot-engine";
import { parseCopilotMode } from "./copilot/copilot-pipeline";
import { diagnoseFromFailure } from "./diagnose";
import { signedAiJson, probeAiService } from "./ai-service";
import { requireRole } from "./auth";

function catalogApps() {
  return listCatalogApps();
}

/**
 * Build a plan preview from prompt heuristics for the Plan & Review modal.
 * This is the fallback when the Python AI service is unavailable.
 */
/**
 * Shared heuristic operation builder for plan fallbacks: derives add_node ops
 * from the apps detected in the prompt. Used both when the Python AI service
 * is unreachable and when it answers without operations (model plane down).
 */
function buildHeuristicOps(prompt: string): Array<{ kind: "add_node"; arguments: Record<string, unknown> }> {
  const preview = _buildPlanPreview(prompt, [], []);
  const ops: Array<{ kind: "add_node"; arguments: Record<string, unknown> }> = [];
  const detectedApps = (preview.apps_used ?? [])
    .map(({ slug }) => APP_CATALOG.find((a) => a.slug === slug))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  // Mirror the preview's own trigger choice (steps[0] holds its app name)
  // so the built graph always matches what the user reviewed.
  const previewTriggerName = preview.steps[0]?.app?.toLowerCase().replace(/\s+/g, "-");
  const previewTriggerApp = previewTriggerName
    ? APP_CATALOG.find((a) => a.slug === previewTriggerName || a.name.toLowerCase() === previewTriggerName)
    : undefined;
  const triggerApp = previewTriggerApp
    ?? detectedApps.find((a) => a.operations.some((o) => o.type === "trigger"))
    ?? APP_CATALOG.find((a) => a.slug === "schedule");
  if (triggerApp) {
    const triggerOp = triggerApp.operations.find((o) => o.type === "trigger");
    if (triggerOp) {
      ops.push({ kind: "add_node", arguments: { appSlug: triggerApp.slug, operation: triggerOp.key, label: triggerOp.name } });
    }
  }
  for (const app of detectedApps) {
    if (app.slug === triggerApp?.slug) continue;
    const actionOp = app.operations.find((o) => o.type !== "trigger");
    if (actionOp) {
      ops.push({ kind: "add_node", arguments: { appSlug: app.slug, operation: actionOp.key, label: actionOp.name } });
    }
  }
  if (ops.length === 0) {
    const httpApp = APP_CATALOG.find((a) => a.slug === "http");
    const httpOp = httpApp?.operations.find((o) => o.type !== "trigger");
    if (httpApp && httpOp) ops.push({ kind: "add_node", arguments: { appSlug: httpApp.slug, operation: httpOp.key, label: httpOp.name } });
  }
  return ops;
}

function _buildPlanPreview(
  prompt: string,
  operations: Array<{ kind: string; arguments: Record<string, unknown> }> = [],
  needsInput: string[] = [],
) {
  const lower = prompt.toLowerCase();
  const apps = APP_CATALOG;
  const usedApps: Array<{ name: string; slug: string }> = [];
  const steps: Array<{ label: string; type: string; app: string }> = [];
  const missingConnections: string[] = [];
  const missingInfo = [...needsInput];
  let confidence = 0.7;

  // Detect apps from prompt
  const appHints: Array<{ re: RegExp; slug: string }> = [
    { re: /gmail|inbox|email/i, slug: "gmail" },
    { re: /google sheet|spreadsheet|sheets/i, slug: "google-sheets" },
    { re: /calendar|meeting/i, slug: "google-calendar" },
    { re: /slack/i, slug: "slack" },
    { re: /hubspot|crm/i, slug: "hubspot" },
    { re: /salesforce|new lead|lead arrives|new prospect/i, slug: "salesforce" },
    { re: /whatsapp/i, slug: "whatsapp" },
    { re: /openai|chatgpt|\bai\b/i, slug: "openai" },
    { re: /webhook|http post/i, slug: "webhook" },
    { re: /schedule|cron|every day/i, slug: "schedule" },
    { re: /form|typeform/i, slug: "typeform" },
    { re: /github/i, slug: "github" },
    { re: /discord/i, slug: "discord" },
    { re: /telegram/i, slug: "telegram" },
  ];

  const detectedSlugs = new Set<string>();
  const slugOrder = new Map<string, number>();
  // Fetch/call-an-API phrasing means an HTTP request step — detected separately
  // from the webhook trigger hint ("http post") so "fetch the weather from an
  // API" plans an HTTP action instead of being dropped.
  if (/\b(?:fetch|call|hit|query|pull)\b[^.;]*\b(?:api|url|endpoint|rest)\b|\bapi\b[^.;]*\b(?:request|call|fetch|get|pull)\b|make\s+(?:an?\s+)?api\s+(?:request|call)|weather|stock\s+price|exchange\s+rate/i.test(lower) && !detectedSlugs.has("http")) {
    const httpApp = apps.find((a) => a.slug === "http");
    if (httpApp) {
      const m = /\b(?:fetch|call|hit|query|pull|weather|stock|exchange)/i.exec(lower);
      detectedSlugs.add("http");
      if (m) slugOrder.set("http", m.index);
      usedApps.push({ name: httpApp.name, slug: httpApp.slug });
    }
  }
  for (const hint of appHints) {
    const m = hint.re.exec(lower);
    if (m && !detectedSlugs.has(hint.slug)) {
      const app = apps.find((a) => a.slug === hint.slug);
      if (app) {
        detectedSlugs.add(hint.slug);
        slugOrder.set(hint.slug, m.index);
        usedApps.push({ name: app.name, slug: app.slug });
      }
    }
  }

  // The trigger lives in the request's opening segment: "When a new lead
  // arrives, … save to Sheets" must anchor on the lead source, not on apps
  // merely mentioned in the action tail.
  const triggerSegment = lower.split(/,| then | and then /)[0] ?? lower;
  const triggerSegmentSlugs = new Set<string>();
  for (const hint of appHints) {
    if (hint.re.test(triggerSegment)) triggerSegmentSlugs.add(hint.slug);
  }

  // Detect trigger type
  if (/schedule|cron|every day|every morning|hourly/i.test(lower)) {
    steps.push({ label: "Schedule Trigger", type: "trigger", app: "schedule" });
  } else if (/webhook|http post|catch hook/i.test(lower)) {
    steps.push({ label: "Webhook Trigger", type: "trigger", app: "webhook" });
  } else if (/form|typeform|submitted/i.test(lower)) {
    steps.push({ label: "Form Submission", type: "trigger", app: "typeform" });
  } else {
    // Prefer an app detected in the opening segment that actually has a
    // trigger operation; otherwise fall back to first detected app.
    const triggerSlug =
      [...triggerSegmentSlugs].find((s) => apps.find((a) => a.slug === s)?.operations.some((o) => o.type === "trigger"))
      ?? [...detectedSlugs][0]
      ?? "manual";
    const app = apps.find((a) => a.slug === triggerSlug);
    const triggerOp = app?.operations.find((o) => o.type === "trigger");
    steps.push({
      label: triggerOp?.name ?? `${app?.name ?? triggerSlug} Trigger`,
      type: "trigger",
      app: app?.name ?? triggerSlug,
    });
  }

  // Add actions for the remaining apps, ordered by where they appear in the
  // request so "analyze with AI and save to Sheets" plans AI before storage.
  const triggerStepApp = steps[0]?.app?.toLowerCase().replace(/\s+/g, "-");
  const actionSlugs = [...detectedSlugs]
    .filter((slug) => slug !== triggerStepApp)
    .sort((a, b) => (slugOrder.get(a) ?? 0) - (slugOrder.get(b) ?? 0));
  for (const slug of actionSlugs) {
    const app = apps.find((a) => a.slug === slug);
    if (!app) continue;
    const actionOp = app.operations.find((o) => o.type !== "trigger");
    steps.push({
      label: actionOp?.name ?? app.name,
      type: "action" as const,
      app: app.name,
    });
  }

  // If no steps detected, add generic ones
  if (steps.length <= 1) {
    steps.push({ label: "Action", type: "action", app: "HTTP" });
  }

  // Check for missing connections
  const SKIP_AUTH = new Set(["webhook", "http", "manual", "schedule", "forms"]);
  for (const step of steps) {
    const app = apps.find((a) => a.name === step.app || a.slug === step.app.toLowerCase().replace(/\s+/g, "-"));
    if (app && !SKIP_AUTH.has(app.slug) && (app.authType ?? "none") !== "none") {
      missingConnections.push(`Connect ${app.name} account`);
    }
  }

  // Deduplicate missing connections
  const uniqueMissing = [...new Set(missingConnections)];

  // Calculate confidence based on how many apps were detected
  if (detectedSlugs.size >= 2) confidence = 0.85;
  else if (detectedSlugs.size === 1) confidence = 0.7;
  else confidence = 0.5;

  return {
    summary: `I'll create a workflow that: ${steps.map((s) => s.label).join(" → ")}`,
    steps,
    apps_used: usedApps,
    missing_connections: uniqueMissing,
    missing_information: missingInfo,
    confidence,
    reasoning: `Detected ${detectedSlugs.size} app(s) from your prompt. ${steps.length} step(s) planned.`,
  };
}

function mapConnStatus(status: string) {
  if (status === "active") return "connected";
  return status;
}

function mapAuthType(raw: string | undefined) {
  const v = String(raw ?? "api_key").toLowerCase();
  if (v === "oauth" || v === "oauth2") return "oauth2";
  if (v === "none") return "none";
  if (v === "basic") return "basic";
  if (v === "custom") return "custom";
  return "api_key";
}

export function registerUiCompat(authed: Router) {
  authed.get("/adapters", async (_req, res) => {
    const { listRegisteredAdapters } = await import("./adapters");
    res.json({ adapters: listRegisteredAdapters() });
  });



  authed.post("/apps/:slug/operations/:op/dynamic-fields", async (req, res) => {
    const handler = getDynamicFieldsHandler(req.params.slug);
    const fields = handler
      ? await handler({
          operation: decodeURIComponent(req.params.op),
          auth: await loadConnectionSecret(req.body?.connectionId, req.orgId!),
          input: req.body?.input ?? {},
          query: req.body?.query,
        })
      : [];
    res.json({ fields });
  });

  authed.get("/connections/setup/:slug", async (req, res) => {
    res.json({ authSchema: authSchemaForSlug(req.params.slug) });
  });

  authed.post("/connections", async (req, res, next) => {
    if (req.body?.pieceName && !req.body?.appSlug && !req.body?.credentials) return next();
    const body = z
      .object({
        appSlug: z.string().min(1).optional(),
        pieceName: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        label: z.string().min(1).optional(),
        authType: z.string().optional(),
        credentials: z.record(z.unknown()).default({}),
        projectId: z.string().uuid().optional(),
      })
      .parse(req.body);
    const appSlug = body.appSlug ?? body.pieceName;
    if (!appSlug) return next();
    const name = body.name ?? body.label ?? "Personal";
    const shape = credentialShapeError(appSlug, body.credentials);
    if (shape) return res.status(400).json({ error: shape, hint: shape });
    const schema = authSchemaForSlug(appSlug);
    const missing = validateAuthCredentials(schema, body.credentials);
    if (missing.length) return res.status(400).json({ error: `Missing ${missing.join(", ")}` });
    const proj =
      body.projectId ??
      (await queryOne<{ id: string }>(`SELECT id FROM projects WHERE org_id = $1 LIMIT 1`, [req.orgId]))!.id;
    const sealed = await sealConnectionSecret(req.orgId!, body.credentials as Record<string, unknown>);
    const row = await queryOne<{ id: string }>(
      `INSERT INTO connections (org_id, project_id, piece_name, label, auth_type, status, ciphertext, encrypted_payload, owner_email)
       VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8) RETURNING id`,
      [
        req.orgId,
        proj,
        appSlug,
        name,
        mapAuthType(body.authType ?? schema.authType),
        sealed.ciphertext,
        JSON.stringify(sealed.encrypted_payload),
        req.user!.email,
      ],
    );
    res.json({ connection: { id: row!.id, name, appSlug, status: "connected" } });
  });

  authed.patch("/connections/:id", async (req, res, next) => {
    if (req.body?.credentials) {
      const sealed = await sealConnectionSecret(req.orgId!, req.body.credentials);
      await query(
        `UPDATE connections SET ciphertext = $3, encrypted_payload = $4, updated_at = now() WHERE id = $1 AND org_id = $2`,
        [req.params.id, req.orgId, sealed.ciphertext, JSON.stringify(sealed.encrypted_payload)],
      );
      return res.json({ connection: { id: req.params.id } });
    }
    if (req.body?.name) {
      const row = await queryOne<{ id: string }>(
        `UPDATE connections SET label = $3, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING id`,
        [req.params.id, req.orgId, String(req.body.name)],
      );
      if (!row) return res.status(404).json({ error: "not_found" });
      return res.json({ connection: { id: row.id, name: String(req.body.name) } });
    }
    return next();
  });

  authed.get("/connections", async (req, res) => {
    const rows = await query(
      `SELECT id, piece_name as app_slug, label as name, auth_type, status, use_count as zap_count, created_at
       FROM connections WHERE org_id = $1 ORDER BY created_at DESC`,
      [req.orgId],
    );
    res.json({
      connections: rows.map((c: any) => ({
        ...c,
        appSlug: c.app_slug,
        status: mapConnStatus(c.status),
        zapCount: c.zap_count ?? 0,
      })),
    });
  });



  authed.get("/executions/:id", async (req, res) => {
    const run = await queryOne(
      `SELECT r.*, f.name as flow_name FROM flow_runs r JOIN flows f ON f.id = r.flow_id
       WHERE r.id = $1 AND r.org_id = $2`,
      [req.params.id, req.orgId],
    );
    if (!run) return res.status(404).json({ error: "not_found" });
    // Join on run_created_at = r.created_at inside Postgres: a JS round-trip
    // drops microseconds, so comparing timestamps client-side never matches
    // the partitioned run_steps rows.
    const steps = await query(
      `SELECT s.* FROM run_steps s
       WHERE s.run_id = $1 AND s.run_created_at = (SELECT r2.created_at FROM flow_runs r2 WHERE r2.id = $1 LIMIT 1)
       ORDER BY s.sequence_no ASC`,
      [run.id],
    );
    const stepNames = await resolveStepNames(run.flow_version_id as string | null | undefined);
    const nodeIds = await resolveNodeIds(run.flow_version_id as string | null | undefined);
    res.json(mapRunToExecution(run as any, steps as any, stepNames, nodeIds));
  });

  /** SSE stream: real-time step-by-step execution updates */
  authed.get("/executions/:id/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let lastStepCount = 0;
    let done = false;
    const runId = req.params.id;
    const orgId = req.orgId!;

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial state
    const run = await queryOne(
      `SELECT r.*, f.name as flow_name FROM flow_runs r JOIN flows f ON f.id = r.flow_id
       WHERE r.id = $1 AND r.org_id = $2`,
      [runId, orgId],
    );
    if (!run) { sendEvent("error", { message: "not_found" }); res.end(); return; }
    const initialSteps = await query(
      `SELECT s.* FROM run_steps s
       WHERE s.run_id = $1 AND s.run_created_at = (SELECT r2.created_at FROM flow_runs r2 WHERE r2.id = $1 LIMIT 1)
       ORDER BY s.sequence_no ASC`,
      [runId],
    );
    lastStepCount = initialSteps.length;
    const nodeIds = await resolveNodeIds((run.flow_version_id as string | null | undefined));
    const nodeIdsByStep = nodeIds; // engine step id → builder node id, reused by the per-step events below
    sendEvent("snapshot", mapRunToExecution(run as any, initialSteps as any, await resolveStepNames((run.flow_version_id as string | null | undefined)), nodeIds));

    // Poll for new steps every 200ms until terminal status
    const terminalStatuses = new Set(["succeeded", "failed", "cancelled", "timeout"]);
    const interval = setInterval(async () => {
      try {
        const currentRun = await queryOne(
          `SELECT r.*, f.name as flow_name FROM flow_runs r JOIN flows f ON f.id = r.flow_id
           WHERE r.id = $1 AND r.org_id = $2`,
          [runId, orgId],
        );
        if (!currentRun) { done = true; return; }
        const steps = await query(
          `SELECT s.* FROM run_steps s
           WHERE s.run_id = $1 AND s.run_created_at = (SELECT r2.created_at FROM flow_runs r2 WHERE r2.id = $1 LIMIT 1)
           ORDER BY s.sequence_no ASC`,
          [runId],
        );
        // Emit new steps as individual events
        for (let i = lastStepCount; i < steps.length; i++) {
          const s = steps[i] as any;
          sendEvent("step", {
            stepId: s.step_id,
            nodeId: nodeIdsByStep[s.step_id] ?? null,
            status: s.status,
            sequenceNo: s.sequence_no,
            durationMs: s.started_at && s.finished_at
              ? new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()
              : null,
            error: s.error_json,
          });
        }
        lastStepCount = steps.length;

        if (terminalStatuses.has(String(currentRun.status))) {
          const doneStepNames = await resolveStepNames((currentRun.flow_version_id as string | null | undefined));
          const doneNodeIds = await resolveNodeIds((currentRun.flow_version_id as string | null | undefined));
          sendEvent("done", mapRunToExecution(currentRun as any, steps as any, doneStepNames, doneNodeIds));
          done = true;
          clearInterval(interval);
          res.end();
        }
      } catch {
        // ignore polling errors
      }
    }, 200);

    // Heartbeat every 5s to keep connection alive
    const heartbeat = setInterval(() => { if (!done) res.write(`: heartbeat\n\n`); }, 5000);

    req.on("close", () => {
      clearInterval(interval);
      clearInterval(heartbeat);
      done = true;
    });
  });

  authed.post("/executions/:id/retry", async (req, res) => {
    const run = await queryOne<{ flow_id: string; context: { trigger?: Record<string, unknown> } }>(
      `SELECT flow_id, context FROM flow_runs WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.orgId],
    );
    if (!run) return res.status(404).json({ error: "not_found" });
    const exec = await createAndRunFlow({
      orgId: req.orgId!,
      flowId: run.flow_id,
      userId: req.user!.userId,
      payload: run.context?.trigger,
      triggerKind: "manual",
    });
    res.json({ execution: { id: exec.id } });
  });

  /**
   * Replay-from-step (P1 #19): re-run only the failed step and everything
   * after it. Steps before `fromStepId` are NOT re-executed — their outputs
   * are copied from the original run into the new run's context, so side
   * effects (emails sent, rows created) are never duplicated.
   */
  authed.post("/executions/:id/replay-from", requireRole("owner", "admin", "editor"), async (req, res) => {
    const fromStepId = typeof (req.body ?? {}).fromStepId === "string" ? (req.body as { fromStepId: string }).fromStepId : "";
    if (!fromStepId) return res.status(400).json({ error: "fromStepId_required" });

    const run = await queryOne<{ flow_id: string; context: { trigger?: Record<string, unknown> } }>(
      `SELECT flow_id, context FROM flow_runs WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.orgId],
    );
    if (!run) return res.status(404).json({ error: "not_found" });

    // Every succeeded step BEFORE the replay point keeps its output.
    const steps = await query<{ step_id: string; sequence_no: number; output_json: unknown }>(
      `SELECT step_id, sequence_no, output_json FROM run_steps
       WHERE run_id = $1 AND org_id = $2 AND status = 'succeeded' ORDER BY sequence_no ASC`,
      [req.params.id, req.orgId],
    );
    const ordered = await query<{ step_id: string; sequence_no: number }>(
      `SELECT step_id, sequence_no FROM run_steps WHERE run_id = $1 AND org_id = $2 ORDER BY sequence_no ASC`,
      [req.params.id, req.orgId],
    );
    const fromSeq = ordered.find((s) => s.step_id === fromStepId)?.sequence_no;
    if (!fromSeq) return res.status(400).json({ error: "unknown_step" });

    const replaySteps: Record<string, Record<string, unknown>> = {};
    for (const s of steps) {
      if (s.sequence_no < fromSeq && s.output_json && typeof s.output_json === "object") {
        replaySteps[s.step_id] = s.output_json as Record<string, unknown>;
      }
    }

    const exec = await createAndRunFlow({
      orgId: req.orgId!,
      flowId: run.flow_id,
      userId: req.user!.userId,
      payload: run.context?.trigger,
      triggerKind: "replay",
      replaySteps,
    });
    res.json({ execution: { id: exec.id }, replayedFromStep: fromStepId, seededSteps: Object.keys(replaySteps).length });
  });

  authed.post("/ai/copilot/generate", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const body = req.body ?? {};
    const send = (data: Record<string, unknown>) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    // Use streamCopilotSession which tries Python AI first, falls back to Node engine
    try {
      const { streamCopilotSession } = await import("./copilot/copilot-http");
      await streamCopilotSession({
        req: req as any,
        res: res as any,
        sessionId: `ui-gen-${Date.now()}`,
        orgId: req.orgId!,
        prompt: String(body.prompt ?? ""),
        mode: body.mode,
        graph: body.graph,
        flowId: body.automationId,
        projectId: req.orgId,
      });
    } catch (err) {
      // Final fallback: local heuristic engine
      try {
        const graph = body.graph ? coerceWorkflowGraph(body.graph) : undefined;
        for await (const ev of runCopilotEngine({
          prompt: String(body.prompt ?? ""),
          workspaceId: req.orgId,
          userEmail: req.user?.email,
          mode: parseCopilotMode(body.mode),
          graph,
        })) {
          if ("result" in ev && ev.type === "result") {
            send({
              type: "result",
              graph: ev.result.graph,
              summary: ev.result.summary,
              applied: true,
              rebuilt: ev.result.rebuilt,
              changed: ev.result.changed,
              mode: body.mode,
            });
          } else {
            send(ev as Record<string, unknown>);
          }
        }
      } catch {
        send({ type: "result", summary: err instanceof Error ? err.message : "Copilot failed", applied: false });
      }
    }
    res.end();
  });

  authed.post("/ai/copilot/accept", async (req, res) => {
    const body = z.object({ automationId: z.string().uuid(), graph: z.unknown() }).parse(req.body);
    // Copilot-applied drafts may still be incomplete; store leniently.
    await query(`UPDATE flows SET draft_definition = $3, updated_at = now() WHERE id = $1 AND org_id = $2`, [
      body.automationId,
      req.orgId,
      JSON.stringify(persistBuilderDraftLenient(body.graph)),
    ]);
    res.json({ ok: true });
  });

  authed.post("/ai/copilot/chat", async (req, res) => {
    const body = z
      .object({
        prompt: z.string(),
        automationId: z.string().optional(),
        graph: z.unknown().optional(),
        selectedStepId: z.string().optional(),
        mode: z.string().optional(),
        lastTest: z.object({ ok: z.boolean().optional(), body: z.unknown().optional(), ms: z.number().optional() }).nullable().optional(),
      })
      .parse(req.body);
    const graph = body.graph ? coerceWorkflowGraph(body.graph) : undefined;

    // Try Python AI service first for intelligent conversational responses
    const ai = await probeAiService();
    if (ai.reachable) {
      try {
        const definition = graph ? persistBuilderDraftLenient(graph) : {};
        const agentReply = await signedAiJson<{
          message: string;
          operations?: Array<{ kind: string; arguments: Record<string, unknown>; requires_confirmation?: boolean }>;
          needs_input?: string[];
        }>(
          "/copilot/chat",
          {
            message: body.prompt,
            workflow: definition,
            catalog: APP_CATALOG.map((a) => ({
              slug: a.slug,
              name: a.name,
              operations: a.operations.map((o) => ({ key: o.key, name: o.name, type: o.type })),
            })),
            history: [],
            session_id: body.automationId ?? "",
            flow_id: body.automationId ?? "",
            org_id: req.orgId ?? "",
          },
          req.orgId!,
        );
        if (agentReply?.message) {
          // Apply Python agent operations through the authoritative applier,
          // rather than discarding them and re-parsing via the local orchestrator.
          let appliedGraph = graph;
          let applied = false;
          let appliedOps: Array<{ kind: string; arguments: Record<string, unknown> }> = [];
          let rejectedOps: Array<{ operation: unknown; reason: string }> = [];
          let needsConfirmation: unknown[] = [];
          if (agentReply.operations?.length && graph) {
            const { applyAgentOperations } = await import("./agent-operation-applier");
            const opResult = await applyAgentOperations({
              graph,
              operations: agentReply.operations,
              workspaceId: req.orgId!,
              organizationId: req.orgId!,
              allowDestructive: parseCopilotMode(body.mode) === "auto_build",
            });
            if (opResult.applied.length > 0) {
              appliedGraph = opResult.graph;
              applied = true;
            }
            appliedOps = opResult.applied;
            rejectedOps = opResult.rejected;
            needsConfirmation = opResult.needsConfirmation;
          }
          // When operations need confirmation, create a session and store
          // the pending operations so the approve endpoint can re-validate
          // them at approval time.
          let sessionId: string | undefined;
          const needsApproval = needsConfirmation.length > 0 || rejectedOps.length > 0;
          if (needsApproval && agentReply.operations?.length) {
            const { ensureProjectId } = await import("./copilot/copilot-http");
            const projectId = await ensureProjectId(req.orgId!);
            const created = await queryOne<{ id: string }>(
              `INSERT INTO copilot_sessions (org_id, project_id, user_id, flow_id, mode)
               VALUES ($1, $2, $3, $4, 'ask_as_you_build') RETURNING id`,
              [req.orgId, projectId, req.user!.userId, body.automationId ?? null],
            );
            sessionId = created!.id;
            await query(
              `UPDATE copilot_sessions SET pending_operations = $2, proposed_definition = $3, stage = 'persist'
               WHERE id = $1`,
              [sessionId, JSON.stringify(agentReply.operations), appliedGraph ? JSON.stringify(persistBuilderDraft(appliedGraph)) : null],
            );
          }
          // Generate suggestions based on current workflow state and the agent reply
          const { generateSuggestionsForAgent, generateClarificationForAgent } = await import("./copilot/copilot");
          const agentSuggestions = generateSuggestionsForAgent(body.prompt, agentReply.message, graph, agentReply.needs_input);
          const agentClarification = agentReply.needs_input?.length ? generateClarificationForAgent(body.prompt, agentReply.needs_input) : undefined;
          // Generate operation cards for workflow modifications
          const agentOpCards = applied && appliedGraph ? [{
            title: "Workflow updated",
            steps: (appliedGraph.nodes ?? []).map((n: { label?: string; appSlug?: string; id: string }) => ({
              label: `${n.label ?? n.id} (${n.appSlug ?? "unknown"})`,
              status: "completed" as const,
            })),
            status: "completed" as const,
            actions: [
              { label: "Test workflow", prompt: "Test this workflow" },
              { label: "Add a step", prompt: "Add the next step" },
            ],
          }] : [];
          res.json({
            reply: agentReply.message,
            graph: applied ? appliedGraph : undefined,
            sessionId,
            applied,
            source: "python-agent",
            youDoFirst: [],
            iCan: agentReply.needs_input?.length ? ["Answer: " + agentReply.needs_input.join(", ")] : [],
            operations: agentOpCards.length ? agentOpCards : undefined,
            suggestions: agentSuggestions,
            clarification: agentClarification,
            applied_operations: appliedOps,
            rejected_operations: rejectedOps,
            needs_confirmation: needsConfirmation,
          });
          return;
        }
      } catch {
        /* Python agent unavailable — fall through to local engine */
      }
    }

    // Local heuristic fallback (with conversation history)
    const { loadChatHistory, appendChatTurn } = await import("./copilot/copilot-http");
    const history = body.automationId ? await loadChatHistory(body.automationId, req.orgId!) : [];
    const result = await copilotChat({
      prompt: body.prompt,
      workspaceId: req.orgId,
      organizationId: req.orgId,
      userId: req.user?.userId,
      userEmail: req.user?.email,
      automationId: body.automationId,
      graph,
      selectedStepId: body.selectedStepId,
      mode: parseCopilotMode(body.mode),
      lastTest: body.lastTest ?? null,
      history,
    });
    // Persist turns for multi-turn memory
    if (body.automationId) {
      const now = new Date().toISOString();
      await appendChatTurn(body.automationId, req.orgId!, { role: "user", content: body.prompt, ts: now });
      await appendChatTurn(body.automationId, req.orgId!, { role: "assistant", content: result.reply, ts: now });
    }
    res.json(result);
  });

  authed.post("/ai/copilot/plan", async (req, res) => {
    const body = z
      .object({
        prompt: z.string().min(1),
        automationId: z.string().uuid().optional(),
        graph: z.unknown().optional(),
        requestId: z.string().optional(),
      })
      .parse(req.body);

    // Each planning request gets a unique requestId so the frontend can
    // discard stale responses when the user edits and resubmits.
    const requestId = body.requestId ?? `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Try Python AI service for intelligent planning
    const ai = await probeAiService();
    if (ai.reachable) {
      try {
        const definition = body.graph ? persistBuilderDraftLenient(body.graph) : {};
        const planResult = await signedAiJson<{
          message?: string;
          reply?: string;
          plan?: string[];
          confidence?: number;
          preview?: {
            summary: string;
            steps: Array<{ label: string; type: string; app: string }>;
            apps_used: Array<{ name: string; slug: string }>;
            missing_connections: string[];
            missing_information: string[];
            confidence: number;
          };
          operations?: Array<{ kind: string; arguments: Record<string, unknown> }>;
          needs_input?: string[];
        }>(
          // The Python agent exposes /copilot/chat (agent_routes.py) — /copilot/plan
          // never existed, so every plan request 404'd and silently degraded to
          // the generic template planner, dropping most planned steps.
          "/copilot/chat",
          {
            message: body.prompt,
            workflow: definition,
            catalog: APP_CATALOG.map((a) => ({
              slug: a.slug,
              name: a.name,
              operations: a.operations.map((o) => ({ key: o.key, name: o.name, type: o.type })),
            })),
          },
          req.orgId!,
          // LLM planning over the full catalog routinely takes 30-60s.
          // The previous default (25s) timed out silently and degraded to
          // the empty local planner — surfacing as "Copilot took too long".
          90000,
        );
        if (planResult) {
          // AgentReply contract (Python): message/plan[]/operations/confidence 0-1.
          const planSteps: Array<{ label: string; type: string; app: string }> = (planResult.plan ?? [])
            .filter((s): s is string => typeof s === "string")
            .slice(0, 12)
            .map((line) => ({ label: line, type: "action", app: "" }));
          const normalizedPreview = planSteps.length
            ? {
                // Internal fallback notes ("AI plane failed…; using the Node
                // catalog engine") must never become the user-facing summary.
                summary: /ai plane|catalog engine|terminated|heuristic planner/i.test(planResult.message ?? "")
                  ? (planResult.preview?.summary ?? planSteps.map((s) => s.label).join(" → "))
                  : planResult.message ?? "",
                steps: planSteps,
                apps_used: planResult.preview?.apps_used ?? [],
                missing_connections: planResult.preview?.missing_connections ?? [],
                missing_information: planResult.preview?.missing_information ?? [],
                confidence: Math.round((planResult.confidence ?? 0.7) * 100) / 100,
              }
            : planResult.preview;
          const rawOps = planResult.operations ?? [];

          // ── Ground operations through the same boundary as /generate ──
          // This ensures every operation is validated against the real catalog
          // and the resulting graph is a valid WorkflowGraph.
          // Start from the RAW graph (no scaffold injection): the empty-graph
          // placeholder trigger/action that coerceWorkflowGraph adds would get
          // persisted into the approved workflow and fail every run.
          let groundedGraph: any = body.graph ? (() => { try { return normalizeWorkflowGraph(body.graph); } catch { return { nodes: [], edges: [] }; } })() : { nodes: [], edges: [] };
          let groundedApplied: Array<{ kind: string; arguments: Record<string, unknown> }> = [];
          let groundedRejected: Array<{ operation: unknown; reason: string }> = [];
          let groundedNeedsConfirmation: unknown[] = [];
          let groundedIssues: Array<{ code: string; message: string }> = [];
          let groundedOperations = rawOps;

          // Model plane answered but produced no operations (e.g. providers
          // down and the graceful fallback returned): keep the preview fall-
          // through consistent by deriving heuristic ops so Approve still
          // builds a real workflow matching the shown plan.
          if (rawOps.length === 0) {
            rawOps.push(...buildHeuristicOps(body.prompt));
          }
          if (rawOps.length > 0) {
            try {
              const { applyAgentOperations } = await import("./agent-operation-applier");
              const result = await applyAgentOperations({
                graph: groundedGraph,
                operations: rawOps,
                workspaceId: req.orgId!,
                organizationId: req.orgId!,
                allowDestructive: false, // plan mode — no destructive ops auto-applied
                scaffold: false, // never persist the empty-graph placeholder trigger/action into approved plans
              });
              groundedGraph = result.graph;
              groundedApplied = result.applied;
              groundedRejected = result.rejected;
              groundedNeedsConfirmation = result.needsConfirmation;
              groundedIssues = result.issues;
              // Replace raw ops with validated ops for the preview and session storage
              groundedOperations = [
                ...result.applied,
                ...result.needsConfirmation,
              ];
            } catch {
              /* grounding failed — fall through with raw operations */
            }
          }

          // Build the preview from grounded operations — same source of truth
          // that the builder will use when the user approves.
          const preview = normalizedPreview ?? _buildPlanPreview(
            body.prompt,
            groundedOperations.map((op) => ({ kind: op.kind, arguments: op.arguments })),
            planResult.needs_input ?? [],
          );

          // Create a session and store pending operations so the approve
          // endpoint can re-validate them at approval time. Sessions without
          // an existing flow get flow_id = NULL — approve adopts the reviewed
          // proposal and creates the workflow server-side (plan → review → build).
          const { ensureProjectId } = await import("./copilot/copilot-http");
          const projectId = await ensureProjectId(req.orgId!);
          const created = await queryOne<{ id: string }>(
            `INSERT INTO copilot_sessions (org_id, project_id, user_id, flow_id, mode)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [req.orgId, projectId, req.user!.userId, body.automationId ?? null, body.automationId ? "ask_as_you_build" : "auto_build"],
          );
          const sessionId: string | undefined = created!.id;
          // Store grounded operations + proposed graph for the approve endpoint
          await query(
            `UPDATE copilot_sessions SET pending_operations = $2, proposed_definition = $3, stage = 'persist'
             WHERE id = $1`,
            [
              sessionId,
              JSON.stringify(groundedOperations),
              JSON.stringify(persistBuilderDraftLenient(groundedGraph)),
            ],
          );

          // Build structured clarification questions from needs_input.
          // missing_connections intentionally stay OUT of clarificationQuestions:
          // they are connection setup tasks, not questions the user can answer
          // with text — gating Approve on "Connect Gmail account" forced the
          // broken "Type your answer…" UX. They surface in the modal's
          // "Needs your attention" list instead.
          const clarificationQuestions: Array<{
            question: string;
            options?: string[];
            required: boolean;
          }> = [];
          for (const input of planResult.needs_input ?? []) {
            // Skip connection-instruction phrasing that leaked into needs_input
            if (/^connect\b/i.test(input)) continue;
            clarificationQuestions.push({ question: input, required: true });
          }

          res.json({
            requestId,
            sessionId,
            reply: planResult.message ?? planResult.reply ?? preview.summary,
            preview,
            graph: groundedGraph,
            operations: groundedOperations,
            applied_operations: groundedApplied,
            rejected_operations: groundedRejected,
            needs_confirmation: groundedNeedsConfirmation,
            issues: groundedIssues,
            needs_input: planResult.needs_input ?? [],
            clarificationQuestions,
            confidence: preview.confidence ?? 0.7,
          });
          return;
        }
      } catch {
        /* Python service unavailable — fall through to local planner */
      }
    }

    // Local heuristic planning fallback. Same contract as the AI path: a
    // session with a grounded, buildable graph so plan → review → build works
    // even without the Python AI service.
    const preview = _buildPlanPreview(body.prompt, [], []);
    const { applyAgentOperations } = await import("./agent-operation-applier");

    // Emit add_node operations from the detected apps — same catalog the
    // preview describes, so the grounded graph matches the shown plan.
    const heuristicOps = buildHeuristicOps(body.prompt);

    let groundedGraph: unknown = { nodes: [], edges: [] };
    let groundedApplied: Array<{ kind: string; arguments: Record<string, unknown> }> = [];
    try {
      const result = await applyAgentOperations({
        graph: { nodes: [], edges: [] },
        operations: heuristicOps,
        workspaceId: req.orgId!,
        organizationId: req.orgId!,
        allowDestructive: false,
        scaffold: false,
      });
      groundedGraph = result.graph;
      groundedApplied = result.applied;
    } catch {
      /* grounding failed — still return a session with the preview */
    }

    const { ensureProjectId } = await import("./copilot/copilot-http");
    const projectId = await ensureProjectId(req.orgId!);
    const sessionCreated = await queryOne<{ id: string }>(
      `INSERT INTO copilot_sessions (org_id, project_id, user_id, flow_id, mode)
       VALUES ($1, $2, $3, NULL, 'auto_build') RETURNING id`,
      [req.orgId, projectId, req.user!.userId],
    );
    await query(
      `UPDATE copilot_sessions SET pending_operations = $2, proposed_definition = $3, stage = 'persist'
       WHERE id = $1`,
      [
        sessionCreated!.id,
        JSON.stringify(groundedApplied),
        JSON.stringify(persistBuilderDraftLenient(groundedGraph)),
      ],
    );

    res.json({
      requestId,
      sessionId: sessionCreated!.id,
      reply: preview.summary,
      preview,
      graph: groundedGraph,
      operations: groundedApplied,
      applied_operations: groundedApplied,
      rejected_operations: [],
      needs_confirmation: [],
      issues: [],
      needs_input: [],
      clarificationQuestions: [],
      confidence: preview.confidence ?? 0.5,
    });
  });

  authed.post("/ai/copilot/diagnose-run", async (req, res) => {
    const runId = String(req.body?.runId ?? "");
    const run = await queryOne<{ status: string; flow_version_id: string | null }>(
      `SELECT status, flow_version_id FROM flow_runs WHERE id = $1 AND org_id = $2`,
      [runId, req.orgId],
    );
    const failed = await queryOne(
      `SELECT step_id, error_json FROM run_steps WHERE run_id = $1 AND status = 'failed' ORDER BY sequence_no DESC LIMIT 1`,
      [runId],
    );
    /* Name the failed step for the user — the engine step id is a sanitized
       internal value (e.g. "d8c5b973_f353_…") that should never surface. */
    const stepNames = await resolveStepNames(run?.flow_version_id ?? null);
    const failedName = failed ? stepNames[String((failed as any).step_id)] ?? String((failed as any).step_id) : undefined;
    const diagnosis = diagnoseFromFailure({
      status: run?.status,
      failed: failed ? { name: failedName, error: (failed as any).error_json } : undefined,
    });
    res.json({ diagnosis });
  });

  authed.get("/automations/:id/versions", async (req, res) => {
    const versions = await query(
      `SELECT id, version_number, published_at, published_by FROM flow_versions WHERE flow_id = $1 AND org_id = $2 ORDER BY version_number DESC`,
      [req.params.id, req.orgId],
    );
    res.json({ versions });
  });

  authed.get("/automations/:id/diff", async (req, res) => {
    const fromId = String(req.query.from ?? "");
    const toId = String(req.query.to ?? "");
    const from = await queryOne<{ definition: unknown; version_number: number }>(
      `SELECT definition, version_number FROM flow_versions WHERE id = $1 AND flow_id = $2 AND org_id = $3`,
      [fromId, req.params.id, req.orgId],
    );
    const to = await queryOne<{ definition: unknown; version_number: number }>(
      `SELECT definition, version_number FROM flow_versions WHERE id = $1 AND flow_id = $2 AND org_id = $3`,
      [toId, req.params.id, req.orgId],
    );
    if (!from || !to) return res.status(404).json({ error: "not_found" });
    res.json({
      from: from.version_number,
      to: to.version_number,
      fromGraph: loadBuilderGraph(from.definition),
      toGraph: loadBuilderGraph(to.definition),
    });
  });

  authed.get("/ai/settings", async (req, res) => {
    const org = await queryOne<{ settings?: Record<string, unknown> }>(`SELECT settings FROM organizations WHERE id = $1`, [req.orgId]);
    const s = org?.settings ?? {};
    res.json({
      settings: {
        workspace_id: req.orgId,
        ai_enabled: s.ai_enabled !== false,
        agents_enabled: s.agents_enabled !== false,
        chatbots_enabled: s.chatbots_enabled !== false,
        pii_filter: s.pii_filter !== false,
        monthly_activity_cap: Number(s.monthly_activity_cap ?? 400),
      },
    });
  });

  authed.put("/ai/settings", async (req, res) => {
    const body = z
      .object({
        aiEnabled: z.boolean().optional(),
        agentsEnabled: z.boolean().optional(),
        chatbotsEnabled: z.boolean().optional(),
        piiFilter: z.boolean().optional(),
        monthlyActivityCap: z.number().optional(),
      })
      .parse(req.body);
    const org = await queryOne<{ settings?: Record<string, unknown> }>(`SELECT settings FROM organizations WHERE id = $1`, [req.orgId]);
    const next = { ...(org?.settings ?? {}) };
    if (body.aiEnabled !== undefined) next.ai_enabled = body.aiEnabled;
    if (body.agentsEnabled !== undefined) next.agents_enabled = body.agentsEnabled;
    if (body.chatbotsEnabled !== undefined) next.chatbots_enabled = body.chatbotsEnabled;
    if (body.piiFilter !== undefined) next.pii_filter = body.piiFilter;
    if (body.monthlyActivityCap !== undefined) next.monthly_activity_cap = body.monthlyActivityCap;
    await query(`UPDATE organizations SET settings = $2, updated_at = now() WHERE id = $1`, [req.orgId, JSON.stringify(next)]);
    res.json({ ok: true, settings: next });
  });

/**
 * Per-workflow run analytics: total runs, success/failure split, timing and
 * last failure — the "how much did this workflow run and what happened" view.
 */
authed.get("/automations/:id/run-stats", async (req, res) => {
  const id = req.params.id;
  const totals = await queryOne<{
    total: string; succeeded: string; failed: string; running: string; waiting: string; cancelled: string;
    avg_ms: string | null; last_run_at: string | null; last_status: string | null;
    last_success_at: string | null; last_failure_at: string | null;
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE status = 'succeeded')::text AS succeeded,
       COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
       COUNT(*) FILTER (WHERE status = 'running')::text AS running,
       COUNT(*) FILTER (WHERE status IN ('waiting','paused'))::text AS waiting,
       COUNT(*) FILTER (WHERE status = 'cancelled')::text AS cancelled,
       ROUND(AVG(duration_ms))::text AS avg_ms,
       MAX(created_at)::text AS last_run_at,
       (SELECT status FROM flow_runs WHERE flow_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 1) AS last_status,
       MAX(created_at) FILTER (WHERE status = 'succeeded')::text AS last_success_at,
       MAX(created_at) FILTER (WHERE status = 'failed')::text AS last_failure_at
     FROM flow_runs WHERE flow_id = $1 AND org_id = $2`,
    [id, req.orgId],
  );
  // Slowest + most failure-prone steps across all runs of this workflow
  const stepStats = await query(
    `SELECT rs.step_id, rs.operation_id, rs.step_type,
            COUNT(*)::int AS executions,
            COUNT(*) FILTER (WHERE rs.status = 'failed')::int AS failures,
            ROUND(AVG(rs.duration_ms))::int AS avg_ms,
            MAX(rs.duration_ms)::int AS max_ms
     FROM run_steps rs
     JOIN flow_runs fr ON fr.id = rs.run_id
     WHERE fr.flow_id = $1 AND fr.org_id = $2
     GROUP BY rs.step_id, rs.operation_id, rs.step_type
     ORDER BY executions DESC
     LIMIT 20`,
    [id, req.orgId],
  );
  // Human-readable step names from the most recently executed version —
  // run_steps stores raw step ids which would otherwise render as UUIDs.
  const latestVersion = await queryOne<{ flow_version_id: string | null }>(
    `SELECT flow_version_id FROM flow_runs
     WHERE flow_id = $1 AND org_id = $2 AND flow_version_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [id, req.orgId],
  );
  const stepNames = await resolveStepNames(latestVersion?.flow_version_id);
  const lastFailure = await queryOne<{ id: string; created_at: string; error_json: unknown }>(
    `SELECT r.id, r.created_at::text, s.error_json
     FROM flow_runs r
     JOIN run_steps s ON s.run_id = r.id AND s.status = 'failed'
     WHERE r.flow_id = $1 AND r.org_id = $2
     ORDER BY r.created_at DESC LIMIT 1`,
    [id, req.orgId],
  );
  res.json({
    totals: {
      total: Number(totals?.total ?? 0),
      succeeded: Number(totals?.succeeded ?? 0),
      failed: Number(totals?.failed ?? 0),
      running: Number(totals?.running ?? 0),
      waiting: Number(totals?.waiting ?? 0),
      cancelled: Number(totals?.cancelled ?? 0),
      avgDurationMs: totals?.avg_ms ? Number(totals.avg_ms) : null,
    },
    lastRunAt: totals?.last_run_at ?? null,
    lastStatus: totals?.last_status ?? null,
    lastSuccessAt: totals?.last_success_at ?? null,
    lastFailure: lastFailure
      ? { runId: lastFailure.id, at: lastFailure.created_at, error: lastFailure.error_json }
      : null,
    steps: (stepStats ?? []).map((s: Record<string, unknown>) => ({
      stepId: s.step_id,
      name: stepNames[s.step_id as string] ?? null,
      operation: s.operation_id,
      type: s.step_type,
      executions: s.executions,
      failures: s.failures,
      avgMs: s.avg_ms,
      maxMs: s.max_ms,
    })),
  });
});

/**
 * Deterministic workflow overview: what each step is (app · action · plain-
 * language description), the flow edges, and actionable guidance. Always
 * available — no model plane required.
 */
authed.get("/automations/:id/overview", async (req, res) => {
  const flow = await queryOne(
    `SELECT f.*, fv.definition as published_definition
     FROM flows f
     LEFT JOIN flow_versions fv ON fv.id = f.published_version_id
     WHERE f.id = $1 AND f.org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!flow) return res.status(404).json({ error: "not_found" });
  const graph = applyAutomationGraphShape(flow as any).graph as {
    nodes: Array<{ id: string; type: string; appSlug: string; operation?: string; label?: string; config?: Record<string, unknown> }>;
    edges: Array<{ source: string; target: string }>;
  };
  const order: string[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  // Walk edges from the trigger for a stable execution order.
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  const visited = new Set<string>();
  const queue: string[] = trigger ? [trigger.id] : graph.nodes.slice(0, 1).map((n) => n.id);
  while (queue.length) {
    const nid = queue.shift()!;
    if (visited.has(nid)) continue;
    visited.add(nid);
    order.push(nid);
    for (const e of graph.edges.filter((e) => e.source === nid)) queue.push(e.target);
  }
  for (const n of graph.nodes) if (!visited.has(n.id)) order.push(n.id);

  const appNames: Record<string, string> = {};
  for (const node of graph.nodes) {
    if (!appNames[node.appSlug]) {
      const app = APP_CATALOG.find((a) => a.slug === node.appSlug);
      appNames[node.appSlug] = app?.name ?? node.appSlug;
    }
  }
  const humanOp = (slug: string, op?: string): string => {
    if (!op) return "built-in step";
    const app = APP_CATALOG.find((a) => a.slug === slug);
    const found = app?.operations.find((o) => o.key === op);
    return found?.name ?? op;
  };
  const describe = (n: (typeof graph.nodes)[number], i: number): string => {
    const label = n.label || humanOp(n.appSlug, n.operation);
    if (n.type === "trigger") {
      return `Starts the workflow when ${describeTrigger(n)}. Its payload (fields from ${appNames[n.appSlug] ?? n.appSlug}) is passed to the next step.`;
    }
    const appLabel = appNames[n.appSlug] ?? n.appSlug;
    const opName = humanOp(n.appSlug, n.operation);
    if (n.appSlug === "openai" || n.appSlug === "anthropic" || n.appSlug === "gemini" || n.appSlug === "ai") {
      return `Step ${i} runs an AI prompt (${opName}) using data from earlier steps. Map fields like {{trigger.subject}} into the prompt, and reference the AI output in later steps.`;
    }
    if (n.appSlug === "filter") return `Step ${i} stops the flow unless its condition matches (filter: ${JSON.stringify(n.config ?? {}).slice(0, 120)}).`;
    return `Step ${i} runs ${appLabel} — ${opName}. Configure its required fields, mapping data from earlier steps (e.g. {{trigger.subject}}).`;
  };
  const steps = order.map((nid, i) => {
    const n = byId.get(nid)!;
    return {
      id: n.id,
      index: i + 1,
      app: appNames[n.appSlug] ?? n.appSlug,
      appSlug: n.appSlug,
      action: n.type === "trigger" ? `Trigger — ${humanOp(n.appSlug, n.operation)}` : humanOp(n.appSlug, n.operation),
      label: n.label ?? humanOp(n.appSlug, n.operation),
      type: n.type,
      description: describe(n, i + 1),
    };
  });
  const issues: string[] = [];
  const stepIds = new Set(graph.nodes.map((n) => n.id));
  for (const e of graph.edges) {
    if (!stepIds.has(e.source) || !stepIds.has(e.target)) issues.push(`Edge ${e.source} → ${e.target} references a missing step.`);
  }
  if (!trigger) issues.push("No trigger step — this workflow can never start.");
  const unconnected = graph.nodes.filter((n) => n.type !== "trigger" && !graph.edges.some((e) => e.target === n.id));
  if (unconnected.length) issues.push(`${unconnected.length} step(s) are not reachable from the trigger: ${unconnected.map((n) => n.label ?? humanOp(n.appSlug, n.operation)).join(", ")}.`);
  const missingConfig: string[] = [];
  for (const n of graph.nodes) {
    if (n.type === "trigger") continue;
    const app = APP_CATALOG.find((a) => a.slug === n.appSlug);
    const op = app?.operations.find((o) => o.key === n.operation);
    const reqs = (op?.inputFields ?? []).filter((f: { required?: boolean }) => f.required);
    const blank = reqs.filter((f: { key: string }) => {
      const v = (n.config ?? {})[f.key];
      return v === undefined || v === null || v === "";
    });
    if (blank.length) missingConfig.push(`${n.label ?? humanOp(n.appSlug, n.operation)}: ${blank.map((f: { key: string }) => f.key).join(", ")}`);
  }
  res.json({
    name: (flow as any).name,
    status: (flow as any).status,
    steps,
    edges: graph.edges,
    analysis: {
      issues,
      missingConfig,
      guidance: [
        ...missingConfig.map((m) => `Open the editor and fill the required fields — ${m}.`),
        ...(issues.length ? issues.map((i) => `Fix structure: ${i}`) : []),
        `Use “Test workflow” to run it once end-to-end, then check Runs → this run for per-step logs and outputs.`,
        `Publish only after a successful test — published workflows run on their real triggers (email, schedule, webhook).`,
      ],
      nextStep: missingConfig.length
        ? "Fill the highlighted required fields in the editor, then run a test."
        : issues.length
          ? "Fix the structural issues above, then run a test."
          : "Run a test workflow; if it succeeds, publish to go live.",
    },
  });
});

function describeTrigger(n: { appSlug: string; operation?: string; config?: Record<string, unknown> }): string {
  const app = APP_CATALOG.find((a) => a.slug === n.appSlug);
  const op = app?.operations.find((o) => o.key === n.operation);
  const name = op?.name ?? "trigger";
  switch (n.appSlug) {
    case "schedule": return `its schedule fires${n.config && "cron" in n.config ? ` (cron: ${String(n.config.cron)})` : ""}`;
    case "webhook": return "a webhook payload arrives";
    case "gmail": return `a new email arrives (${name})`;
    case "forms": return "a form is submitted";
    case "manual": return "you press Run";
    default: return `${app?.name ?? n.appSlug} reports ${name}`;
  }
}

}

export function applyAutomationGraphShape(row: any) {
  const graph = loadBuilderGraph(row.draft_definition);
  return {
    id: row.id,
    name: row.name,
    status: row.status === "active" ? "on" : row.status === "disabled" ? "off" : "draft",
    graph,
    updated_at: row.updated_at,
    created_at: row.created_at,
    slug: row.slug,
    origin: row.origin,
  };
}

export async function saveAutomationGraph(req: Request, res: Response, next: () => void) {
  if (!req.body?.graph) return next();
  // Builder autosave: a work-in-progress graph (unwired node, half-configured
  // step) must store instead of 400 — strict compilation gates test/publish.
  const draft = persistBuilderDraftLenient(req.body.graph);
  const sets: string[] = ["draft_definition = $3", "updated_at = now()"];
  const params: unknown[] = [req.params.id, req.orgId, JSON.stringify(draft)];
  if (req.body.name) {
    sets.push("name = $4");
    params.push(req.body.name);
  }
  await query(`UPDATE flows SET ${sets.join(", ")} WHERE id = $1 AND org_id = $2`, params);
  res.json({ ok: true });
}
