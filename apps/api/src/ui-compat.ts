import type { Router, Request, Response } from "express";
import { z } from "zod";
import { coerceWorkflowGraph } from "@algoverge/core";
import { APP_CATALOG, getApp, listCatalogApps } from "./catalog/catalog";
import { authSchemaForSlug, credentialShapeError, validateAuthCredentials } from "./auth-schema";
import { getDynamicFieldsHandler } from "./adapters";
import { query, queryOne } from "./db";
import { persistBuilderDraft, loadBuilderGraph, createAndRunFlow, testFlowStep, mapRunToExecution, sealConnectionSecret, loadConnectionSecret } from "./flow-runtime";
import { validateWorkflowGraph } from "./workflow-validation";
import { copilotGraph, copilotChat } from "./copilot/copilot";
import { runCopilotEngine } from "./copilot/copilot-engine";
import { parseCopilotMode } from "./copilot/copilot-pipeline";
import { diagnoseFromFailure } from "./diagnose";
import { signedAiJson, probeAiService } from "./ai-service";

function catalogApps() {
  return listCatalogApps();
}

/**
 * Build a plan preview from prompt heuristics for the Plan & Review modal.
 * This is the fallback when the Python AI service is unavailable.
 */
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
    { re: /whatsapp/i, slug: "whatsapp" },
    { re: /openai|chatgpt|ai/i, slug: "openai" },
    { re: /webhook|http post/i, slug: "webhook" },
    { re: /schedule|cron|every day/i, slug: "schedule" },
    { re: /form|typeform/i, slug: "typeform" },
    { re: /github/i, slug: "github" },
    { re: /discord/i, slug: "discord" },
    { re: /telegram/i, slug: "telegram" },
  ];

  const detectedSlugs = new Set<string>();
  for (const hint of appHints) {
    if (hint.re.test(lower) && !detectedSlugs.has(hint.slug)) {
      const app = apps.find((a) => a.slug === hint.slug);
      if (app) {
        detectedSlugs.add(hint.slug);
        usedApps.push({ name: app.name, slug: app.slug });
      }
    }
  }

  // Detect trigger type
  if (/schedule|cron|every day|every morning|hourly/i.test(lower)) {
    steps.push({ label: "Schedule Trigger", type: "trigger", app: "schedule" });
  } else if (/webhook|http post|catch hook/i.test(lower)) {
    steps.push({ label: "Webhook Trigger", type: "trigger", app: "webhook" });
  } else if (/form|typeform|submitted/i.test(lower)) {
    steps.push({ label: "Form Submission", type: "trigger", app: "typeform" });
  } else {
    // Find the first app with a trigger
    const triggerApp = detectedSlugs.size > 0 ? [...detectedSlugs][0] : "manual";
    const app = apps.find((a) => a.slug === triggerApp);
    const triggerOp = app?.operations.find((o) => o.type === "trigger");
    steps.push({
      label: triggerOp?.name ?? `${app?.name ?? triggerApp} Trigger`,
      type: "trigger",
      app: app?.name ?? triggerApp,
    });
  }

  // Add actions for detected apps (skip the first one which is the trigger)
  let actionIndex = 0;
  for (const slug of detectedSlugs) {
    if (actionIndex === 0 && steps[0]?.app === slug) {
      actionIndex++;
      continue;
    }
    const app = apps.find((a) => a.slug === slug);
    if (!app) continue;
    const actionOp = app.operations.find((o) => o.type !== "trigger");
    steps.push({
      label: actionOp?.name ?? app.name,
      type: "action" as const,
      app: app.name,
    });
    actionIndex++;
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
    const steps = await query(
      `SELECT * FROM run_steps WHERE run_id = $1 AND run_created_at = $2 ORDER BY sequence_no ASC`,
      [run.id, run.created_at],
    );
    res.json(mapRunToExecution(run as any, steps as any));
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
      `SELECT * FROM run_steps WHERE run_id = $1 AND run_created_at = $2 ORDER BY sequence_no ASC`,
      [runId, run.created_at],
    );
    lastStepCount = initialSteps.length;
    sendEvent("snapshot", mapRunToExecution(run as any, initialSteps as any));

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
          `SELECT * FROM run_steps WHERE run_id = $1 AND run_created_at = $2 ORDER BY sequence_no ASC`,
          [runId, currentRun.created_at],
        );
        // Emit new steps as individual events
        for (let i = lastStepCount; i < steps.length; i++) {
          const s = steps[i] as any;
          sendEvent("step", {
            stepId: s.step_id,
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
          sendEvent("done", mapRunToExecution(currentRun as any, steps as any));
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
    await query(`UPDATE flows SET draft_definition = $3, updated_at = now() WHERE id = $1 AND org_id = $2`, [
      body.automationId,
      req.orgId,
      JSON.stringify(persistBuilderDraft(body.graph)),
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
        const definition = graph ? persistBuilderDraft(graph) : {};
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
          res.json({
            reply: agentReply.message,
            graph: applied ? appliedGraph : undefined,
            sessionId,
            applied,
            source: "python-agent",
            youDoFirst: [],
            iCan: agentReply.needs_input?.length ? ["Answer: " + agentReply.needs_input.join(", ")] : [],
            operations: agentReply.operations ?? [],
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

    // Local heuristic fallback
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
    });
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
        const definition = body.graph ? persistBuilderDraft(body.graph) : {};
        const planResult = await signedAiJson<{
          reply?: string;
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
          "/copilot/plan",
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
        );
        if (planResult) {
          const rawOps = planResult.operations ?? [];

          // ── Ground operations through the same boundary as /generate ──
          // This ensures every operation is validated against the real catalog
          // and the resulting graph is a valid WorkflowGraph.
          let groundedGraph: any = body.graph ? (() => { try { return coerceWorkflowGraph(body.graph); } catch { return { nodes: [], edges: [] }; } })() : { nodes: [], edges: [] };
          let groundedApplied: Array<{ kind: string; arguments: Record<string, unknown> }> = [];
          let groundedRejected: Array<{ operation: unknown; reason: string }> = [];
          let groundedNeedsConfirmation: unknown[] = [];
          let groundedIssues: Array<{ code: string; message: string }> = [];
          let groundedOperations = rawOps;

          if (rawOps.length > 0) {
            try {
              const { applyAgentOperations } = await import("./agent-operation-applier");
              const result = await applyAgentOperations({
                graph: groundedGraph,
                operations: rawOps,
                workspaceId: req.orgId!,
                organizationId: req.orgId!,
                allowDestructive: false, // plan mode — no destructive ops auto-applied
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
          const preview = planResult.preview ?? _buildPlanPreview(
            body.prompt,
            groundedOperations.map((op) => ({ kind: op.kind, arguments: op.arguments })),
            planResult.needs_input ?? [],
          );

          // Create a session and store pending operations so the approve
          // endpoint can re-validate them at approval time.
          let sessionId: string | undefined;
          if (body.automationId) {
            const { ensureProjectId } = await import("./copilot/copilot-http");
            const projectId = await ensureProjectId(req.orgId!);
            const created = await queryOne<{ id: string }>(
              `INSERT INTO copilot_sessions (org_id, project_id, user_id, flow_id, mode)
               VALUES ($1, $2, $3, $4, 'ask_as_you_build') RETURNING id`,
              [req.orgId, projectId, req.user!.userId, body.automationId],
            );
            sessionId = created!.id;
            // Store grounded operations + proposed graph for the approve endpoint
            const { persistBuilderDraft } = await import("./flow-runtime");
            await query(
              `UPDATE copilot_sessions SET pending_operations = $2, proposed_definition = $3, stage = 'persist'
               WHERE id = $1`,
              [
                sessionId,
                JSON.stringify(groundedOperations),
                JSON.stringify(persistBuilderDraft(groundedGraph)),
              ],
            );
          }

          // Build structured clarification questions from needs_input +
          // missing_connections. These become interactive questions in
          // Plan & Review rather than flat text warnings.
          const clarificationQuestions: Array<{
            question: string;
            options?: string[];
            required: boolean;
          }> = [];
          for (const input of planResult.needs_input ?? []) {
            clarificationQuestions.push({ question: input, required: true });
          }
          for (const conn of preview.missing_connections ?? []) {
            // Avoid duplicating needs_input entries
            if (!clarificationQuestions.some((q) => q.question === conn)) {
              clarificationQuestions.push({ question: conn, required: true });
            }
          }

          res.json({
            requestId,
            sessionId,
            reply: planResult.reply ?? preview.summary,
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

    // Local heuristic planning fallback
    const preview = _buildPlanPreview(body.prompt, [], []);
    res.json({
      requestId,
      reply: preview.summary,
      preview,
      operations: [],
      needs_input: [],
    });
  });

  authed.post("/ai/copilot/diagnose-run", async (req, res) => {
    const runId = String(req.body?.runId ?? "");
    const run = await queryOne<{ status: string }>(
      `SELECT status FROM flow_runs WHERE id = $1 AND org_id = $2`,
      [runId, req.orgId],
    );
    const failed = await queryOne(
      `SELECT step_id, error_json FROM run_steps WHERE run_id = $1 AND status = 'failed' ORDER BY sequence_no DESC LIMIT 1`,
      [runId],
    );
    const diagnosis = diagnoseFromFailure({
      status: run?.status,
      failed: failed ? { name: String((failed as any).step_id), error: (failed as any).error_json } : undefined,
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
  const draft = persistBuilderDraft(req.body.graph);
  const sets: string[] = ["draft_definition = $3", "updated_at = now()"];
  const params: unknown[] = [req.params.id, req.orgId, JSON.stringify(draft)];
  if (req.body.name) {
    sets.push("name = $4");
    params.push(req.body.name);
  }
  await query(`UPDATE flows SET ${sets.join(", ")} WHERE id = $1 AND org_id = $2`, params);
  res.json({ ok: true });
}
