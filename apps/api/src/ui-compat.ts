import type { Router, Request, Response } from "express";
import { z } from "zod";
import { coerceWorkflowGraph } from "@algoverge/core";
import { APP_CATALOG, getApp, listCatalogApps } from "./catalog";
import { authSchemaForSlug, credentialShapeError, validateAuthCredentials } from "./auth-schema";
import { getDynamicFieldsHandler } from "./adapters";
import { query, queryOne } from "./db";
import { persistBuilderDraft, loadBuilderGraph, createAndRunFlow, testFlowStep, mapRunToExecution, sealConnectionSecret, loadConnectionSecret } from "./flow-runtime";
import { validateWorkflowGraph } from "./workflow-validation";
import { copilotGraph, copilotChat } from "./copilot";
import { runCopilotEngine } from "./copilot-engine";
import { parseCopilotMode } from "./copilot-pipeline";
import { diagnoseFromFailure } from "./diagnose";
import { signedAiJson, probeAiService } from "./ai-service";

function catalogApps() {
  return listCatalogApps();
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

  authed.get("/apps", async (req, res) => {
    const q = String(req.query.q ?? "").toLowerCase();
    let apps = catalogApps();
    if (q) apps = apps.filter((a) => `${a.slug} ${a.name} ${a.description}`.toLowerCase().includes(q));
    res.json({ apps });
  });

  authed.get("/apps/:slug", async (req, res) => {
    const app = getApp(req.params.slug);
    if (!app) return res.status(404).json({ error: "not_found" });
    res.json({ app: catalogApps().find((a) => a.slug === app.slug) });
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

  authed.post("/automations/:id/test-step", async (req, res) => {
    const result = await testFlowStep({
      orgId: req.orgId!,
      flowId: req.params.id,
      nodeId: String(req.body?.nodeId ?? ""),
      graph: req.body?.graph,
    });
    res.json(result);
  });

  authed.post("/automations/:id/run", async (req, res) => {
    const exec = await createAndRunFlow({
      orgId: req.orgId!,
      flowId: req.params.id,
      userId: req.user!.userId,
      payload: req.body?.payload,
      graph: req.body?.graph,
      triggerKind: "test",
    });
    res.json({ execution: { id: exec.id } });
  });

  authed.post("/automations/:id/publish", async (req, res) => {
    req.url = `/flows/${req.params.id}/publish`;
    // Reuse flow publish after converting graph if present
    const flow = await queryOne<{ draft_definition: unknown }>(
      `SELECT draft_definition FROM flows WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.orgId],
    );
    if (!flow) return res.status(404).json({ error: "not_found" });
    const { issues } = await validateWorkflowGraph(loadBuilderGraph(flow.draft_definition), {
      workspaceId: req.orgId!,
      strict: true,
    });
    if (issues.length) {
      return res.status(400).json({ error: "invalid_flow", issues: issues.map((i) => ({ message: i.message })) });
    }
    const draft = persistBuilderDraft(loadBuilderGraph(flow.draft_definition));
    await query(`UPDATE flows SET draft_definition = $3, updated_at = now() WHERE id = $1 AND org_id = $2`, [
      req.params.id,
      req.orgId,
      JSON.stringify(draft),
    ]);
    const hashMod = await import("@algoverge/core");
    const hash = hashMod.definitionHash(draft);
    const last = await queryOne<{ version_number: number }>(
      `SELECT version_number FROM flow_versions WHERE flow_id = $1 ORDER BY version_number DESC LIMIT 1`,
      [req.params.id],
    );
    const version = await queryOne<{ id: string }>(
      `INSERT INTO flow_versions (org_id, flow_id, definition, definition_hash, version_number, published_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (flow_id, definition_hash) DO UPDATE SET published_at = now()
       RETURNING id`,
      [req.orgId, req.params.id, JSON.stringify(draft), hash, (last?.version_number ?? 0) + 1, req.user!.userId],
    );
    await query(`UPDATE flows SET published_version_id = $1, status = 'active', updated_at = now() WHERE id = $2`, [
      version!.id,
      req.params.id,
    ]);
    try {
      const { TriggerActivationService } = await import("./triggers/trigger-activation.service");
      const { env } = await import("./config");
      await new TriggerActivationService({ getTrigger: () => ({}) }, env.apiUrl).onPublished(version!.id);
    } catch {
      /* trigger registry is best-effort */
    }
    const hook = await queryOne<{ webhook_token: string | null }>(
      `SELECT webhook_token FROM triggers_registry WHERE flow_id = $1 AND status = 'active' AND webhook_token IS NOT NULL LIMIT 1`,
      [req.params.id],
    );
    const { env } = await import("./config");
    const webhookUrl = hook?.webhook_token
      ? `${env.apiUrl.replace(/\/$/, "")}/api/v1/webhooks/inbound/${hook.webhook_token}`
      : null;
    res.json({ ok: true, webhookUrl });
  });

  authed.post("/automations/:id/validate", async (req, res) => {
    const graph = req.body?.graph ?? loadBuilderGraph(
      (await queryOne<{ draft_definition: unknown }>(`SELECT draft_definition FROM flows WHERE id = $1 AND org_id = $2`, [
        req.params.id,
        req.orgId,
      ]))?.draft_definition,
    );
    const { issues } = await validateWorkflowGraph(graph, { workspaceId: req.orgId!, strict: true });
    res.json({ ok: issues.length === 0, issues: issues.map((i) => ({ message: i.message })) });
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
      const { streamCopilotSession } = await import("./copilot-http");
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
          res.json({
            reply: agentReply.message,
            graph: applied ? appliedGraph : undefined,
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
