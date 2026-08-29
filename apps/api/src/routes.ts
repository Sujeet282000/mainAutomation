// =============================================================================
// Orchestra Part 10 — API Routes
// Source of truth: Part 10 § "Endpoint surface"
// This is the complete boundary the frontend consumes.
// =============================================================================

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import { query, queryOne } from "./db";
import {
  authMiddleware,
  orgMiddleware,
  requireRole,
  serviceAuthMiddleware,
  signToken,
} from "./auth";
import { env } from "./config";
import { definitionHash } from "@algoverge/core";
import { oauthRouter } from "./oauth";
import { registerUiCompat, applyAutomationGraphShape } from "./ui-compat";
import { persistBuilderDraft, loadBuilderGraph } from "./flow-runtime";
import { copilotGraph, copilotChat } from "./copilot/copilot";
import { runCopilotEngine } from "./copilot/copilot-engine";
import { ensureProjectId, refineCopilotSession, streamCopilotSession } from "./copilot/copilot-http";
import { probeAiService, signedAiJson } from "./ai-service";

export const router = Router();
router.use("/oauth", oauthRouter);

// ── Health & Meta (unauthenticated) ─────────────────────────────────────────

router.get("/health", async (_req, res) => {
  const ai = await probeAiService();
  res.json({
    ok: true,
    version: "0.1.0",
    ai: {
      reachable: ai.reachable,
      mode: ai.mode,
      openaiConfigured: ai.openaiConfigured,
      anthropicConfigured: ai.anthropicConfigured,
    },
  });
});

router.get("/meta", (_req, res) => {
  res.json({
    name: "Orchestra",
    version: "0.1.0",
    docs: "/docs",
  });
});

router.get("/catalog", async (req, res) => {
  const { listCatalogApps } = await import("./catalog/catalog");
  res.json({ apps: listCatalogApps(req.query.q as string | undefined) });
});

router.get("/public/forms/:workspaceId/:slug", async (req, res) => {
  const form = await queryOne<{ id: string; name: string; schema_json: { fields?: unknown[] } }>(
    `SELECT id, name, schema_json FROM data_tables WHERE org_id = $1 AND slug = $2 AND name LIKE 'form:%'`,
    [req.params.workspaceId, req.params.slug],
  );
  if (!form) return res.status(404).json({ error: "not_found" });
  res.json({
    form: {
      name: String(form.name).replace(/^form:/, ""),
      fields: form.schema_json?.fields ?? [],
    },
  });
});

router.post("/public/forms/:workspaceId/:slug", async (req, res) => {
  const form = await queryOne<{
    id: string;
    org_id: string;
    schema_json: { fields?: unknown[]; table_id?: string; automation_id?: string };
  }>(
    `SELECT id, org_id, schema_json FROM data_tables WHERE org_id = $1 AND slug = $2 AND name LIKE 'form:%'`,
    [req.params.workspaceId, req.params.slug],
  );
  if (!form) return res.status(404).json({ error: "not_found" });
  const data = req.body && typeof req.body === "object" ? req.body : {};
  const row = await queryOne<{ id: string }>(
    `INSERT INTO data_table_rows (org_id, table_id, data) VALUES ($1, $2, $3) RETURNING id`,
    [form.org_id, form.id, JSON.stringify(data)],
  );
  if (form.schema_json?.table_id) {
    await query(`INSERT INTO data_table_rows (org_id, table_id, data) VALUES ($1, $2, $3)`, [
      form.org_id,
      form.schema_json.table_id,
      JSON.stringify(data),
    ]).catch(() => undefined);
  }
  if (form.schema_json?.automation_id) {
    const { createAndRunFlow } = await import("./flow-runtime");
    const member = await queryOne<{ user_id: string }>(
      `SELECT user_id FROM org_members WHERE org_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [form.org_id],
    );
    if (member) {
      await createAndRunFlow({
        orgId: form.org_id,
        flowId: form.schema_json.automation_id,
        userId: member.user_id,
        payload: data as Record<string, unknown>,
        triggerKind: "form",
      }).catch(() => undefined);
    }
  }
  res.json({ ok: true, submission: { id: row!.id } });
});

// ── Auth ────────────────────────────────────────────────────────────────────

router.post("/auth/register", async (req, res) => {
  try {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        name: z.string().min(1),
        organization: z.string().optional(),
      })
      .parse(req.body);

    const bcryptMod = await import("bcryptjs");
    const bcrypt = (bcryptMod as any).default ?? bcryptMod;
    const hash = await bcrypt.hash(body.password, 10);

    let user: { id: string; email: string } | null = null;
    try {
      user = await queryOne<{ id: string; email: string }>(
        `INSERT INTO users (email, full_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email`,
        [body.email.toLowerCase(), body.name, hash],
      );
    } catch {
      return res
        .status(409)
        .json({ error: "email_taken", hint: "An account with this email already exists." });
    }
    if (!user) return res.status(400).json({ error: "could_not_create_user" });

    // Create organization
    const slug = `${(body.organization ?? body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${user.id.slice(0, 6)}`;
    const org = await queryOne<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [body.organization ?? `${body.name}'s workspace`, slug],
    );

    // Add owner membership
    await query(
      `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [org!.id, user.id],
    );

    // Create default project
    const project = await queryOne<{ id: string }>(
      `INSERT INTO projects (org_id, name, slug) VALUES ($1, 'Main', 'main') RETURNING id`,
      [org!.id],
    );

    const token = signToken({ userId: user.id, email: user.email, orgId: org!.id });
    const workspace = { id: org!.id, name: body.organization ?? `${body.name}'s workspace`, slug };
    res.json({ token, user, organization: org, project, workspace, workspaces: [workspace] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "invalid_input" });
    }
    console.error("REGISTER_ERROR:", err);
    return res.status(500).json({ error: "register_failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const body = z
      .object({ email: z.string().email(), password: z.string() })
      .parse(req.body);

    const bcryptMod = await import("bcryptjs");
    const bcrypt = (bcryptMod as any).default ?? bcryptMod;
    const user = await queryOne<{ id: string; email: string; password_hash: string }>(
      `SELECT id, email, password_hash FROM users WHERE email = $1`,
      [body.email.toLowerCase()],
    );

    if (!user?.password_hash || !(await bcrypt.compare(body.password, user.password_hash))) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const member = await queryOne<{ org_id: string }>(
      `SELECT org_id FROM org_members WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [user.id],
    );

    const token = signToken({
      userId: user.id,
      email: user.email,
      orgId: member?.org_id,
    });

    const org = member
      ? await queryOne<{ id: string; name: string; slug: string }>(`SELECT id, name, slug FROM organizations WHERE id = $1`, [member.org_id])
      : null;
    const workspace = org ? { id: org.id, name: org.name, slug: org.slug } : null;
    res.json({ token, user: { id: user.id, email: user.email }, organization: org, workspace, workspaces: workspace ? [workspace] : [] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "invalid_input" });
    }
    return res.status(500).json({ error: "login_failed" });
  }
});

router.get("/me", authMiddleware, orgMiddleware, async (req, res) => {
  const user = await queryOne(
    `SELECT id, email, full_name, avatar_url FROM users WHERE id = $1`,
    [req.user!.userId],
  );
  const org = await queryOne(
    `SELECT o.* FROM organizations o WHERE o.id = $1`,
    [req.orgId],
  );
  const role = await queryOne<{ role: string }>(
    `SELECT role FROM org_members WHERE user_id = $1 AND org_id = $2`,
    [req.user!.userId, req.orgId],
  );
  const project = await queryOne(
    `SELECT id, name, slug FROM projects WHERE org_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [req.orgId],
  );
  res.json({
    user,
    organization: org,
    role: role?.role ?? "viewer",
    project,
    workspace: org,
    workspaces: org ? [{ ...(org as object), role: role?.role ?? "viewer" }] : [],
  });
});

// ── Authenticated routes ────────────────────────────────────────────────────

const authed = Router();
authed.use(authMiddleware, orgMiddleware);

// Viewer guard for mutations
authed.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (req.orgRole === "viewer") return res.status(403).json({ error: "read_only" });
  next();
});

registerUiCompat(authed);

// ============================================================================
// FLOWS (Part 10 § "Flows and versions")
// ============================================================================

authed.get("/flows", async (req, res) => {
  const projectId = req.query.projectId as string | undefined;
  let q = `SELECT f.*, fv.version_number as published_version_number
           FROM flows f
           LEFT JOIN flow_versions fv ON fv.id = f.published_version_id
           WHERE f.org_id = $1`;
  const params: unknown[] = [req.orgId];
  if (projectId) {
    q += ` AND f.project_id = $2`;
    params.push(projectId);
  }
  q += ` ORDER BY f.updated_at DESC`;
  const rows = await query(q, params);
  res.json({ flows: rows });
});

authed.post("/flows", async (req, res) => {
  // Auto-resolve projectId if not provided
  let projectId: string;
  let flowName: string;
  let slug: string | undefined;
  let origin = "manual" as string;
  try {
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        name: z.string().min(1),
        slug: z.string().optional(),
        origin: z.enum(["manual", "copilot", "template", "api", "import"]).default("manual"),
      })
      .parse(req.body);
    projectId = parsed.projectId;
    flowName = parsed.name;
    slug = parsed.slug;
    origin = parsed.origin;
  } catch {
    const proj = await queryOne<{ id: string }>(
      `SELECT id FROM projects WHERE org_id = $1 LIMIT 1`,
      [req.orgId],
    );
    projectId = proj!.id;
    flowName = req.body?.name ?? "Untitled workflow";
  }

  const baseSlug = slug || flowName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const finalSlug = baseSlug + "-" + Date.now().toString(36);

  const defaultDraft = { schemaVersion: 1, trigger: { id: "trigger", type: "manual", props: {} }, steps: [], settings: { timezone: "UTC" } };
  const flow = await queryOne<{ id: string }>(
    `INSERT INTO flows (org_id, project_id, name, slug, origin, created_by, draft_definition)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [req.orgId, projectId, flowName, finalSlug, origin, req.user!.userId, JSON.stringify(defaultDraft)],
  );

  res.json({ flow: { id: flow!.id, name: flowName, slug: finalSlug } });
});

authed.get("/flows/:id", async (req, res) => {
  const flow = await queryOne(
    `SELECT f.*, fv.definition as published_definition, fv.definition_hash as published_hash
     FROM flows f
     LEFT JOIN flow_versions fv ON fv.id = f.published_version_id
     WHERE f.id = $1 AND f.org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!flow) return res.status(404).json({ error: "not_found" });

  const todos = await query(
    `SELECT t.* FROM todos t
     JOIN flow_runs fr ON t.run_id = fr.id
     WHERE t.org_id = $1 AND fr.flow_id = $2 AND t.status = 'pending'
     ORDER BY t.created_at DESC`,
    [req.orgId, req.params.id],
  );

  const graph = applyAutomationGraphShape(flow).graph;
  res.json({ flow: { ...flow, draft_definition: graph }, graph, todos });
});

authed.delete("/flows/:id", async (req, res) => {
  await query(`DELETE FROM flows WHERE id = $1 AND org_id = $2`, [req.params.id, req.orgId]);
  res.json({ ok: true });
});

authed.patch("/flows/:id", async (req, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      draft_definition: z.record(z.unknown()).optional(),
      status: z.enum(["draft", "active", "paused", "disabled"]).optional(),
    })
    .parse(req.body);

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 3;

  if (body.name) {
    sets.push(`name = $${i}`);
    params.push(body.name);
    i++;
  }
  if (body.draft_definition) {
    const rec = body.draft_definition as Record<string, unknown>;
    const draft = Array.isArray(rec.nodes) ? persistBuilderDraft(rec) : rec.schemaVersion ? rec : persistBuilderDraft(rec);
    sets.push(`draft_definition = $${i}`);
    params.push(JSON.stringify(draft));
    i++;
  }
  if (body.status) {
    sets.push(`status = $${i}`);
    params.push(body.status);
    i++;
  }

  if (sets.length === 0) return res.status(400).json({ error: "nothing_to_update" });

  sets.push("updated_at = now()", "updated_by = $" + i);
  params.push(req.user!.userId);

  await query(
    `UPDATE flows SET ${sets.join(", ")} WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId, ...params],
  );

  res.json({ ok: true });
});

// POST /flows/:id/publish — create immutable version, activate triggers
authed.post(
  "/flows/:id/publish",
  requireRole("owner", "admin", "editor"),
  async (req, res) => {
    const flow = await queryOne<{ id: string; draft_definition: any }>(
      `SELECT id, draft_definition FROM flows WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.orgId],
    );
    if (!flow) return res.status(404).json({ error: "not_found" });

    const def = persistBuilderDraft(loadBuilderGraph(flow.draft_definition));
    const { safeParseFlowDefinition } = await import("@algoverge/core");
    const validation = safeParseFlowDefinition(def);
    if (!validation.success) {
      return res.status(400).json({ error: "invalid_flow", message: validation.error?.message });
    }

    const hash = definitionHash(def);

    const last = await queryOne<{ version_number: number }>(
      `SELECT version_number FROM flow_versions WHERE flow_id = $1 ORDER BY version_number DESC LIMIT 1`,
      [flow.id],
    );
    const nextVersion = (last?.version_number ?? 0) + 1;

    const version = await queryOne<{ id: string }>(
      `INSERT INTO flow_versions (org_id, flow_id, definition, definition_hash, version_number, published_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.orgId, flow.id, JSON.stringify(def), hash, nextVersion, req.user!.userId],
    );

    await query(
      `UPDATE flows SET published_version_id = $1, status = 'active', updated_at = now() WHERE id = $2`,
      [version!.id, flow.id],
    );

    try {
      const { TriggerActivationService } = await import("./triggers/trigger-activation.service");
      await new TriggerActivationService({ getTrigger: () => ({}) }, env.apiUrl).onPublished(version!.id);
    } catch {
      /* activation is best-effort */
    }

    // Audit log
    await query(
      `INSERT INTO audit_logs (org_id, actor_id, actor_kind, action, target_type, target_id, metadata)
       VALUES ($1, $2, 'user', 'publish', 'flow', $3, $4)`,
      [req.orgId, req.user!.userId, flow.id, JSON.stringify({ version: nextVersion, hash })],
    );

    const hook = await queryOne<{ webhook_token: string | null }>(
      `SELECT webhook_token FROM triggers_registry WHERE flow_id = $1 AND status = 'active' AND webhook_token IS NOT NULL LIMIT 1`,
      [flow.id],
    );
    const webhookUrl = hook?.webhook_token
      ? `${env.apiUrl.replace(/\/$/, "")}/api/v1/webhooks/inbound/${hook.webhook_token}`
      : null;
    res.json({ ok: true, versionId: version!.id, version: nextVersion, hash, webhookUrl });
  },
);

// POST /flows/:id/validate
authed.post("/flows/:id/validate", async (req, res) => {
  const flow = await queryOne<{ draft_definition: any }>(
    `SELECT draft_definition FROM flows WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!flow) return res.status(404).json({ error: "not_found" });

  const { safeParseFlowDefinition } = await import("@algoverge/core");
  const validation = safeParseFlowDefinition(req.body?.definition ?? flow.draft_definition);

  res.json({
    ok: validation.success,
    issues: validation.success
      ? []
      : [{ severity: "error", code: "INVALID_FLOW", message: validation.error?.message }],
  });
});

// POST /flows/:id/activate — activate triggers
authed.post("/flows/:id/activate", requireRole("owner", "admin", "editor"), async (req, res) => {
  await query(
    `UPDATE flows SET status = 'active', updated_at = now() WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  res.json({ ok: true });
});

// POST /flows/:id/deactivate
authed.post("/flows/:id/deactivate", requireRole("owner", "admin", "editor"), async (req, res) => {
  await query(
    `UPDATE flows SET status = 'disabled', updated_at = now() WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  res.json({ ok: true });
});

// POST /flows/:id/step/:stepId/test — execute one step against resolved inputs
authed.post("/flows/:id/step/:stepId/test", requireRole("owner", "admin", "editor"), async (req, res) => {
  const body = z
    .object({
      inputs: z.record(z.unknown()).default({}),
    })
    .parse(req.body);

  // In production, this runs the step handler against the provided inputs
  // For now, return a placeholder
  res.json({
    ok: true,
    output: body.inputs,
    duration_ms: 0,
    status: "succeeded",
  });
});

// ============================================================================
// CONNECTIONS (Part 10 § "Connections")
// ============================================================================

// NOTE: GET /connections, POST /connections, PATCH /connections/:id live in ui-compat.ts
// (they have credential sealing logic). DELETE /connections/:id and POST /test live here.

authed.delete("/connections/:id", async (req, res) => {
  // Check for dependent flows
  const deps = await query<{ flow_id: string }>(
    `SELECT DISTINCT flow_id FROM triggers_registry WHERE connection_id = $1 AND status = 'active'`,
    [req.params.id],
  );
  if (deps.length > 0) {
    return res.status(409).json({
      error: "connection_in_use",
      message: `Connection is used by ${deps.length} flow(s)`,
      flowIds: deps.map((d) => d.flow_id),
    });
  }

  await query(
    `DELETE FROM connections WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  res.json({ ok: true });
});

// POST /connections/:id/test — verify connection works
authed.post("/connections/:id/test", async (req, res) => {
  const conn = await queryOne<{ id: string; piece_name: string }>(
    `SELECT id, piece_name FROM connections WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!conn) return res.status(404).json({ error: "not_found" });
  const { loadConnectionSecret } = await import("./flow-runtime");
  const auth = await loadConnectionSecret(conn.id, req.orgId!);
  if (!auth || !Object.keys(auth).length) {
    return res.status(400).json({ error: "missing_credentials", hint: "Reconnect this account with valid credentials." });
  }
  try {
    if (conn.piece_name === "openai") {
      const { testOpenAiConnection } = await import("./adapters");
      await testOpenAiConnection(auth);
    } else if (["gmail", "google-sheets", "google-calendar", "google-drive"].includes(conn.piece_name)) {
      const { testGoogleConnection } = await import("./adapters");
      await testGoogleConnection(auth, conn.id, req.orgId);
    } else if (conn.piece_name === "slack") {
      const token = String(auth.bot_token ?? auth.access_token ?? "");
      if (!token) throw new Error("Slack bot_token is missing from the connection.");
      const res = await fetch("https://slack.com/api/auth.test", {
        headers: { authorization: `Bearer ${token}` }
      });
      const body = await res.json() as { ok?: boolean; error?: string; user?: string; team?: string };
      if (!body.ok) throw new Error(`Slack auth.test failed: ${body.error ?? "unknown"}. Reconnect with a valid bot token (xoxb-...).`);
    } else if (conn.piece_name === "github") {
      const token = String(auth.access_token ?? auth.api_key ?? "");
      if (!token) throw new Error("GitHub token is missing from the connection.");
      const res = await fetch("https://api.github.com/user", {
        headers: { authorization: `token ${token}`, "user-agent": "orchestra" }
      });
      if (!res.ok) throw new Error(`GitHub auth failed (${res.status}). Reconnect with a valid token.`);
    } else if (conn.piece_name === "telegram") {
      const token = String(auth.api_key ?? auth.bot_token ?? "");
      if (!token) throw new Error("Telegram bot token is missing.");
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const body = await res.json() as { ok?: boolean; description?: string };
      if (!body.ok) throw new Error(`Telegram auth failed: ${body.description ?? "unknown"}.`);
    } else if (conn.piece_name === "hubspot") {
      const token = String(auth.access_token ?? "");
      if (!token) throw new Error("HubSpot access token is missing.");
      const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
        headers: { authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HubSpot auth failed (${res.status}). Reconnect with a valid token.`);
    } else if (conn.piece_name === "stripe") {
      const token = String(auth.api_key ?? auth.secret_key ?? "");
      if (!token) throw new Error("Stripe secret key is missing.");
      const res = await fetch("https://api.stripe.com/v1/balance", {
        headers: { authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Stripe auth failed (${res.status}). Reconnect with a valid key.`);
    }
    await query(`UPDATE connections SET status = 'active', updated_at = now() WHERE id = $1 AND org_id = $2`, [
      conn.id,
      req.orgId,
    ]);
    res.json({ ok: true, status: "connected" });
  } catch (err) {
    res.status(400).json({ error: "test_failed", hint: err instanceof Error ? err.message : "Connection test failed" });
  }
});

// NOTE: PATCH /connections/:id lives in ui-compat.ts (credential sealing)

// ============================================================================
// PIECES & CATALOG (Part 10 § "Pieces and catalog")
// ============================================================================

authed.get("/pieces", async (req, res) => {
  const kind = req.query.kind as string | undefined;
  let q = `SELECT po.*, p.display_name as piece_display_name, p.version as piece_version, p.name as piece_name
           FROM piece_operations po
           JOIN pieces p ON p.id = po.piece_id AND p.org_id = po.org_id
           WHERE (p.visibility = 'public' OR p.org_id = $1)`;
  const params: unknown[] = [req.orgId];
  if (kind) {
    q += ` AND po.kind = $2`;
    params.push(kind);
  }
  q += ` ORDER BY po.display_name`;
  const rows = await query(q, params);
  res.json({ pieces: rows });
});

authed.post("/pieces/search", async (req, res) => {
  const body = z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(50).default(12) }).parse(req.body);
  const rows = await query(
    `SELECT po.*, p.display_name as piece_display_name, p.version as piece_version, p.name as piece_name
     FROM piece_operations po
     JOIN pieces p ON p.id = po.piece_id AND p.org_id = po.org_id
     WHERE (p.visibility = 'public' OR p.org_id = $1)
       AND po.text ILIKE '%' || $2 || '%'
     ORDER BY po.display_name
     LIMIT $3`,
    [req.orgId, body.query, body.limit],
  );
  res.json({ results: rows });
});

// ============================================================================
// RUNS (Part 10 § "Run inspection")
// ============================================================================

authed.get("/runs", async (req, res) => {
  const flowId = req.query.flowId as string | undefined;
  let q = `SELECT r.*, f.name as flow_name
           FROM flow_runs r
           JOIN flows f ON f.id = r.flow_id
           WHERE r.org_id = $1`;
  const params: unknown[] = [req.orgId];
  if (flowId) {
    q += ` AND r.flow_id = $2`;
    params.push(flowId);
  }
  q += ` ORDER BY r.created_at DESC LIMIT 100`;
  const rows = await query(q, params);
  res.json({ runs: rows });
});

authed.get("/runs/:id", async (req, res) => {
  const run = await queryOne(
    `SELECT r.*, f.name as flow_name
     FROM flow_runs r
     JOIN flows f ON f.id = r.flow_id
     WHERE r.id = $1 AND r.org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!run) return res.status(404).json({ error: "not_found" });

  const steps = await query(
    `SELECT * FROM run_steps WHERE run_id = $1 AND run_created_at = $2 ORDER BY sequence_no ASC`,
    [run.id, run.created_at],
  );

  res.json({ run, steps });
});

// GET /runs/:id/stream — Run SSE contract (Part 10)
authed.get("/runs/:id/stream", async (req, res) => {
  const run = await queryOne(
    `SELECT id, status FROM flow_runs WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!run) return res.status(404).json({ error: "not_found" });

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const sendEvent = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Keep-alive every 15s
  const keepAlive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 15_000);

  // Send current state
  sendEvent("run_started", {
    runId: run.id,
    status: run.status,
  });

  // If run is terminal, send final event and close
  if (["succeeded", "failed", "cancelled", "filtered"].includes(run.status as string)) {
    sendEvent("run_finished", { status: run.status });
    clearInterval(keepAlive);
    res.end();
    return;
  }

  // In production, subscribe to Redis pub-sub for real-time updates
  // For now, poll the database every 2 seconds
  const poll = setInterval(async () => {
    try {
      const current = await queryOne<{ status: string }>(
        `SELECT status FROM flow_runs WHERE id = $1`,
        [run.id],
      );

      if (!current) {
        clearInterval(poll);
        clearInterval(keepAlive);
        res.end();
        return;
      }

      // Get latest steps
      const steps = await query<{ step_id: string; status: string; duration_ms: number | null }>(
        `SELECT step_id, status, duration_ms FROM run_steps WHERE run_id = $1 ORDER BY sequence_no DESC LIMIT 1`,
        [run.id],
      );

      if (steps.length > 0) {
        const step = steps[0];
        sendEvent("step_finished", {
          stepId: step.step_id,
          status: step.status,
          durationMs: step.duration_ms,
        });
      }

      if (["succeeded", "failed", "cancelled", "filtered"].includes(current.status)) {
        sendEvent("run_finished", { status: current.status });
        clearInterval(poll);
        clearInterval(keepAlive);
        res.end();
      }
    } catch {
      // Ignore polling errors
    }
  }, 2000);

  req.on("close", () => {
    clearInterval(poll);
    clearInterval(keepAlive);
  });
});

// ============================================================================
// COPILOT (Part 10 § "Copilot SSE contract")
// ============================================================================

authed.post("/copilot/sessions", async (req, res) => {
  const body = z
    .object({
      prompt: z.string().min(1).optional(),
      flowId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      mode: z.enum(["auto_build", "ask_as_you_build"]).default("auto_build"),
      timezone: z.string().default("UTC"),
    })
    .parse(req.body);

  const projectId = body.projectId ?? (await ensureProjectId(req.orgId!));

  const session = await queryOne<{ id: string }>(
    `INSERT INTO copilot_sessions (org_id, project_id, user_id, flow_id, mode)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.orgId, projectId, req.user!.userId, body.flowId ?? null, body.mode],
  );

  res.json({ sessionId: session!.id, projectId });
});

// POST /copilot/sessions/:id/generate — SSE streaming from Node copilot-engine
authed.post("/copilot/sessions/:id/generate", async (req, res) => {
  const session = await queryOne<{ id: string; org_id: string; mode: string }>(
    `SELECT id, org_id, mode FROM copilot_sessions WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!session) return res.status(404).json({ error: "not_found" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Session-Id", session.id);
  res.flushHeaders?.();

  const keepAlive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 15_000);

  try {
    await streamCopilotSession({
      req,
      res,
      sessionId: session.id,
      orgId: session.org_id,
      prompt: String(req.body?.prompt ?? req.body?.request_text ?? ""),
      mode: req.body?.mode ?? session.mode,
      graph: req.body?.graph,
      flowId: String(req.body?.flowId ?? ""),
      projectId: String(req.body?.projectId ?? ""),
    });
  } catch (err) {
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        code: "COPILOT_FAILED",
        message: err instanceof Error ? err.message : "Copilot failed",
      })}\n\n`,
    );
  }

  clearInterval(keepAlive);
  res.end();
});

// POST /copilot/sessions/:id/refine — Node engine chat/patch (no Python)
authed.post("/copilot/sessions/:id/refine", async (req, res) => {
  const body = z
    .object({
      request_text: z.string().min(1).optional(),
      prompt: z.string().min(1).optional(),
      timezone: z.string().default("UTC"),
      graph: z.unknown().optional(),
      mode: z.string().optional(),
      selectedStepId: z.string().nullable().optional(),
      flowId: z.string().uuid().nullable().optional(),
    })
    .parse(req.body);
  const prompt = body.prompt ?? body.request_text ?? "";
  if (!prompt) return res.status(400).json({ error: "missing_prompt" });

  const session = await queryOne<{ id: string }>(
    `SELECT id FROM copilot_sessions WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!session) return res.status(404).json({ error: "not_found" });

  const result = await refineCopilotSession({
    sessionId: session.id,
    orgId: req.orgId!,
    userId: req.user?.userId,
    userEmail: req.user?.email,
    prompt,
    mode: body.mode ?? undefined,
    graph: body.graph ?? undefined,
    flowId: body.flowId ?? undefined,
    selectedStepId: body.selectedStepId ?? undefined,
  });
  res.json(result);
});

// POST /copilot/sessions/:id/answer — ask_as_you_build answers (Node)
authed.post("/copilot/sessions/:id/answer", async (req, res) => {
  const body = z
    .object({
      answers: z.record(z.string()),
      graph: z.unknown().optional(),
      flowId: z.string().uuid().optional(),
    })
    .parse(req.body);

  const session = await queryOne<{ id: string }>(
    `SELECT id FROM copilot_sessions WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!session) return res.status(404).json({ error: "not_found" });

  const prompt = Object.entries(body.answers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const result = await refineCopilotSession({
    sessionId: session.id,
    orgId: req.orgId!,
    userId: req.user?.userId,
    userEmail: req.user?.email,
    prompt: `Answers for this workflow:\n${prompt}`,
    graph: body.graph,
    flowId: body.flowId,
  });
  res.json(result);
});

// POST /copilot/sessions/:id/persist — persist draft to flow
authed.post("/copilot/sessions/:id/persist", requireRole("owner", "admin", "editor"), async (req, res) => {
  const session = await queryOne<{ id: string; org_id: string; flow_id: string | null; project_id: string }>(
    `SELECT id, org_id, flow_id, project_id FROM copilot_sessions WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!session) return res.status(404).json({ error: "not_found" });

  const body = z
    .object({
      flowId: z.string().uuid().optional(),
    })
    .parse(req.body);

  const flowId = body.flowId ?? session.flow_id;
  if (!flowId) {
    return res.status(400).json({ error: "no_flow_to_persist_to" });
  }

  // Load the proposed definition from the session
  const proposal = await queryOne<{ proposed_definition: any }>(
    `SELECT proposed_definition FROM copilot_sessions WHERE id = $1`,
    [session.id],
  );

  if (!proposal?.proposed_definition) {
    return res.status(400).json({ error: "no_proposal_to_persist" });
  }

  // Save draft
  await query(
    `UPDATE flows SET draft_definition = $3, updated_at = now(), updated_by = $4
     WHERE id = $1 AND org_id = $2`,
    [flowId, req.orgId, JSON.stringify(proposal.proposed_definition), req.user!.userId],
  );

  // Update session status
  await query(
    `UPDATE copilot_sessions SET status = 'completed' WHERE id = $1`,
    [session.id],
  );

  // Audit log
  await query(
    `INSERT INTO audit_logs (org_id, actor_id, actor_kind, action, target_type, target_id, metadata)
     VALUES ($1, $2, 'user', 'copilot_persist', 'flow', $3, $4)`,
    [req.orgId, req.user!.userId, flowId, JSON.stringify({ sessionId: session.id })],
  );

  res.json({ ok: true, flowId });
});

// POST /copilot/build — Build an AutomationPlan atomically into a persisted workflow
authed.post("/copilot/build", requireRole("owner", "admin", "editor"), async (req, res) => {
  const body = z
    .object({
      plan: z.record(z.unknown()),
      projectId: z.string().uuid().optional(),
    })
    .parse(req.body);

  try {
    const { buildPlanAtomically } = await import("./copilot/copilot-plan-builder");
    const { AutomationPlan } = await import("@algoverge/shared");

    // Validate plan structure
    const planParsed = AutomationPlan.safeParse(body.plan);
    if (!planParsed.success) {
      return res.status(400).json({ error: "invalid_plan", details: planParsed.error.flatten() });
    }

    const result = await buildPlanAtomically({
      plan: planParsed.data,
      workspaceId: req.orgId!,
      userId: req.user!.userId,
      projectId: body.projectId,
    });

    res.json({ ok: true, flowId: result.flowId, graph: result.graph });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "build_failed", detail: msg });
  }
});

// GET /copilot/readiness — Show integration readiness stats with acceptance checklist
authed.get("/copilot/readiness", async (req, res) => {
  const { getCatalogReadiness, getReadinessStats } = await import("./catalog/catalog-readiness");
  const { generateAcceptanceChecklist, generateAcceptanceReport } = await import("./integration-test-harness");
  const stats = getReadinessStats();
  const apps = [...getCatalogReadiness().values()];

  // Add acceptance checklist to each app
  const appsWithChecklist = apps.map((app) => ({
    ...app,
    acceptance: generateAcceptanceChecklist(app.slug),
  }));

  const report = generateAcceptanceReport();
  res.json({ stats, apps: appsWithChecklist, report });
});

// GET /copilot/readiness/:slug — Show detailed readiness for a specific app
authed.get("/copilot/readiness/:slug", async (req, res) => {
  const { getCatalogReadiness } = await import("./catalog/catalog-readiness");
  const { generateAcceptanceChecklist } = await import("./integration-test-harness");
  const { getAppFixtures } = await import("./test-data-fixtures");
  const app = getCatalogReadiness().get(req.params.slug);
  if (!app) return res.status(404).json({ error: "app_not_found" });
  const acceptance = generateAcceptanceChecklist(app.slug);
  const fixtures = getAppFixtures(app.slug);
  res.json({ app, acceptance, fixtures });
});

// POST /copilot/test-step — Test a single workflow step against a real provider
authed.post("/copilot/test-step", requireRole("owner", "admin", "editor"), async (req, res) => {
  const body = z
    .object({
      appSlug: z.string(),
      operation: z.string(),
      connectionId: z.string().uuid().optional(),
      config: z.record(z.unknown()).default({}),
    })
    .parse(req.body);

  const { getFixture } = await import("./test-data-fixtures");
  const { getAdapter } = await import("./adapters/registry");

  const adapter = getAdapter(body.appSlug, body.operation);
  if (!adapter) {
    // Return sample data from fixtures instead
    const fixture = getFixture(body.appSlug, body.operation);
    if (fixture) {
      return res.json({
        ok: true,
        appSlug: body.appSlug,
        operation: body.operation,
        executionTimeMs: 0,
        output: fixture.sampleOutput,
        error: undefined,
        errorType: "none",
        sampleSaved: false,
        note: "No live adapter — returned sample fixture data",
      });
    }
    return res.status(400).json({ error: "no_adapter", detail: `No adapter for ${body.appSlug}.${body.operation}` });
  }

  // Execute real adapter call
  const start = Date.now();
  try {
    const result = await adapter({
      appSlug: body.appSlug,
      operation: body.operation,
      input: body.config,
      auth: null, // Connection auth resolved separately
      workspaceId: req.orgId!,
      executionId: `test-${Date.now()}`,
      connectionId: body.connectionId,
    });
    res.json({
      ok: true,
      appSlug: body.appSlug,
      operation: body.operation,
      executionTimeMs: Date.now() - start,
      output: result.output,
      error: undefined,
      errorType: "none",
      sampleSaved: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errorType = /auth|token|401|403/i.test(msg) ? "auth_error"
      : /rate|429/i.test(msg) ? "rate_limit"
      : /timeout/i.test(msg) ? "timeout"
      : /valid/i.test(msg) ? "validation_error"
      : "provider_error";
    res.json({
      ok: false,
      appSlug: body.appSlug,
      operation: body.operation,
      executionTimeMs: Date.now() - start,
      output: undefined,
      error: msg,
      errorType,
      sampleSaved: false,
    });
  }
});

// GET /copilot/fixtures — List all available test fixtures
authed.get("/copilot/fixtures", async (req, res) => {
  const { TEST_FIXTURES, getFixedAppSlugs } = await import("./test-data-fixtures");
  res.json({
    total: TEST_FIXTURES.length,
    apps: getFixedAppSlugs(),
    fixtures: TEST_FIXTURES.map((f) => ({
      appSlug: f.appSlug,
      operation: f.operation,
      description: f.description,
    })),
  });
});

authed.get("/copilot/status", async (req, res) => {
  const ai = await probeAiService();
  res.json({
    ok: true,
    plane: ai.reachable ? "python" : "node",
    ...ai,
  });
});

authed.post("/copilot/generate", async (req, res) => {
  const body = z
    .object({
      prompt: z.string().min(1),
      flowId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      mode: z.enum(["auto_build", "ask_as_you_build"]).default("auto_build"),
      graph: z.unknown().optional(),
    })
    .parse(req.body);
  const projectId = body.projectId ?? (await ensureProjectId(req.orgId!));
  const session = await queryOne<{ id: string }>(
    `INSERT INTO copilot_sessions (org_id, project_id, user_id, flow_id, mode) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.orgId, projectId, req.user!.userId, body.flowId ?? null, body.mode],
  );
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Session-Id", session!.id);
  res.flushHeaders?.();
  const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 15_000);
  try {
    await streamCopilotSession({
      req,
      res,
      sessionId: session!.id,
      orgId: req.orgId!,
      prompt: body.prompt,
      mode: body.mode,
      graph: body.graph,
      flowId: body.flowId,
      projectId,
    });
  } catch (err) {
    res.write(
      `data: ${JSON.stringify({ type: "error", code: "COPILOT_FAILED", message: err instanceof Error ? err.message : "Copilot failed" })}\n\n`,
    );
  }
  clearInterval(keepAlive);
  res.end();
});

authed.post("/copilot/refine", async (req, res) => {
  const body = z
    .object({
      prompt: z.string().min(1).optional(),
      instruction: z.string().min(1).optional(),
      sessionId: z.string().uuid().optional(),
      flowId: z.string().uuid().optional(),
      graph: z.unknown().optional(),
      mode: z.string().optional(),
    })
    .parse(req.body);
  const prompt = body.prompt ?? body.instruction ?? "";
  if (!prompt) return res.status(400).json({ error: "missing_prompt" });
  let sessionId = body.sessionId;
  if (!sessionId) {
    const created = await queryOne<{ id: string }>(
      `INSERT INTO copilot_sessions (org_id, project_id, user_id, flow_id, mode)
       VALUES ($1, $2, $3, $4, 'auto_build') RETURNING id`,
      [req.orgId, await ensureProjectId(req.orgId!), req.user!.userId, body.flowId ?? null],
    );
    sessionId = created!.id;
  }
  const result = await refineCopilotSession({
    sessionId,
    orgId: req.orgId!,
    userId: req.user?.userId,
    userEmail: req.user?.email,
    prompt,
    mode: body.mode,
    graph: body.graph,
    flowId: body.flowId,
  });
  res.json(result);
});

/**
 * POST /copilot/sessions/:sessionId/approve
 *
 * Server-authoritative approval boundary. The browser sends only the sessionId
 * (and optionally flowId). The server decides exactly what is being approved:
 *
 *   1. Load session — reject if missing, completed, or not in active state
 *   2. Load pending_operations from the session (stored by copilot-http)
 *   3. Load CURRENT workflow graph from the flows table
 *   4. Re-validate operations against the current catalog and current graph
 *   5. Apply with explicit approval (allowDestructive=true for user-approved ops)
 *   6. Validate the resulting graph
 *   7. Persist as draft
 *   8. Mark session completed
 *   9. Audit log
 *  10. Return the validated graph to the frontend
 *
 * Protection against:
 *   - stale proposal / already-completed session
 *   - browser-supplied replacement operations
 *   - wrong workspace / wrong flow
 *   - unknown catalog operations
 *   - invalid resulting workflow
 *   - credential injection
 *   - bypassing confirmation
 *   - partial application
 */
authed.post("/copilot/sessions/:sessionId/approve", requireRole("owner", "admin", "editor"), async (req, res) => {
  // 1. Load session and verify state
  const session = await queryOne<{
    id: string; org_id: string; flow_id: string | null; status: string;
    pending_operations: unknown[] | null; proposed_definition: unknown;
  }>(
    `SELECT id, org_id, flow_id, status, pending_operations, proposed_definition
     FROM copilot_sessions WHERE id = $1 AND org_id = $2`,
    [req.params.sessionId, req.orgId],
  );
  if (!session) return res.status(404).json({ error: "session_not_found" });
  if (session.status !== "active") {
    return res.status(409).json({ error: "session_not_active", status: session.status });
  }

  // 2. Load pending operations from the session — browser cannot supply replacements
  const pendingOps = session.pending_operations;
  if (!Array.isArray(pendingOps) || pendingOps.length === 0) {
    return res.status(400).json({ error: "no_pending_operations" });
  }

  // 3. Determine target flow and load CURRENT workflow graph
  const body = z.object({ flowId: z.string().uuid().optional() }).parse(req.body ?? {});
  const flowId = body.flowId ?? session.flow_id;
  if (!flowId) return res.status(400).json({ error: "no_flow" });

  const flow = await queryOne<{ draft_definition: unknown }>(
    `SELECT draft_definition FROM flows WHERE id = $1 AND org_id = $2`,
    [flowId, req.orgId],
  );
  if (!flow) return res.status(404).json({ error: "flow_not_found" });

  const currentGraph = loadBuilderGraph(flow.draft_definition);

  // 4-5. Re-validate operations against current catalog and apply with approval
  const { applyAgentOperations } = await import("./agent-operation-applier");
  const result = await applyAgentOperations({
    graph: currentGraph,
    operations: pendingOps,
    workspaceId: req.orgId!,
    organizationId: req.orgId!,
    allowDestructive: true, // user explicitly approved — destructive ops allowed
  });

  // Reject if any operations were rejected during re-validation
  if (result.rejected.length > 0) {
    return res.status(422).json({
      error: "operations_rejected",
      rejected: result.rejected,
      issues: result.issues,
    });
  }

  // 6. Validate the resulting graph
  const { validateWorkflowGraph } = await import("./workflow-validation");
  const validation = await validateWorkflowGraph(result.graph, {
    workspaceId: req.orgId!,
    strict: true,
  });
  if (validation.issues.length > 0) {
    return res.status(422).json({
      error: "invalid_resulting_graph",
      issues: validation.issues,
    });
  }

  // 7. Persist as draft
  const draft = persistBuilderDraft(validation.graph);
  await query(
    `UPDATE flows SET draft_definition = $3, updated_at = now(), updated_by = $4
     WHERE id = $1 AND org_id = $2`,
    [flowId, req.orgId, JSON.stringify(draft), req.user!.userId],
  );

  // 8. Mark session completed
  await query(
    `UPDATE copilot_sessions SET status = 'completed', pending_operations = NULL, updated_at = now()
     WHERE id = $1`,
    [session.id],
  );

  // 9. Audit log
  await query(
    `INSERT INTO audit_logs (org_id, actor_id, actor_kind, action, target_type, target_id, metadata)
     VALUES ($1, $2, 'user', 'copilot_approve', 'flow', $3, $4)`,
    [req.orgId, req.user!.userId, flowId, JSON.stringify({
      sessionId: session.id,
      applied: result.applied.length,
      rejected: result.rejected.length,
      needsConfirmation: result.needsConfirmation.length,
    })],
  ).catch(() => undefined);

  // 10. Return the validated graph so the frontend can hydrate from it
  res.json({
    ok: true,
    flowId,
    graph: validation.graph,
    applied: result.applied,
    rejected: result.rejected,
    needsConfirmation: result.needsConfirmation,
    issues: result.issues,
  });
});

authed.post("/copilot/suggest-field", async (req, res) => {
  const body = z.object({ definition: z.record(z.unknown()).optional(), stepId: z.string(), prop: z.string() }).parse(req.body);
  const hit = await signedAiJson("/copilot/assist/map-field", { definition: body.definition ?? {}, step_id: body.stepId, prop: body.prop }, req.orgId!);
  res.json(hit ?? { suggestions: [{ expression: `{{trigger.${body.prop}}}`, confidence: 0.3 }] });
});

authed.post("/copilot/explain-field", async (req, res) => {
  const body = z.object({ stepId: z.string().optional(), prop: z.string() }).parse(req.body);
  res.json({
    explanation: `${body.prop} is mapped from an upstream step. Leave it blank if you are not sure — a wrong mapping is worse than an empty required field.`,
  });
});

authed.post("/copilot/suggest-next-step", async (req, res) => {
  const body = z.object({ definition: z.record(z.unknown()).optional(), goalHint: z.string().optional() }).parse(req.body);
  const hit = await signedAiJson("/copilot/assist/suggest-next", { definition: body.definition ?? {}, goal_hint: body.goalHint }, req.orgId!);
  res.json(hit ?? { suggestions: [] });
});

authed.post("/copilot/diagnose-run", async (req, res) => {
  const runId = String(req.body?.runId ?? "");
  const run = await queryOne(
    `SELECT status, error, context FROM flow_runs WHERE id = $1 AND org_id = $2`,
    [runId, req.orgId],
  );
  const failed = await queryOne(
    `SELECT step_id, error_json FROM run_steps WHERE run_id = $1 AND status = 'failed' ORDER BY sequence_no DESC LIMIT 1`,
    [runId],
  );
  const hit = await signedAiJson("/copilot/diagnose", { run_context: { run, failed } }, req.orgId!);
  res.json({ diagnosis: hit ?? { root_cause: "Could not reach the AI plane.", human_fix: "Retry after the AI service is up, or inspect the failed step.", confidence: 0.2 } });
});

// ============================================================================
// TOOL EXECUTION (Part 9 — Python calls Node to execute tools)
// ============================================================================

authed.post("/internal/execute-tool", requireRole("owner", "admin", "editor"), async (req, res) => {
  const body = z
    .object({
      operation_id: z.string(),
      connection_id: z.string().uuid().nullable().optional(),
      arguments: z.record(z.unknown()),
      run_id: z.string(),
      step_id: z.string(),
      nonce: z.string(),
    })
    .parse(req.body);

  const used = await queryOne(
    `SELECT id FROM run_steps WHERE effect_key = $1`,
    [body.nonce],
  );
  if (used) {
    return res.status(409).json({ ok: false, code: "NONCE_REUSED", message: "Tool nonce already used" });
  }

  try {
    const { runAdapter } = await import("./adapters");
    const auth = body.connection_id
      ? await loadConnectionAuth(body.connection_id, req.orgId!)
      : null;

    const result = await runAdapter({
      appSlug: body.operation_id.split(":")[0],
      operation: body.operation_id.split(":")[2] ?? body.operation_id,
      input: body.arguments,
      auth,
      workspaceId: req.orgId!,
      executionId: body.run_id,
      connectionId: body.connection_id ?? undefined,
    });

    res.json({ ok: true, output: result.output });
  } catch (err) {
    res.json({
      ok: false,
      code: "FATAL",
      message: err instanceof Error ? err.message : "tool execution failed",
    });
  }
});

// ============================================================================
// INTERNAL ENDPOINTS (for Python AI service callbacks)
// ============================================================================

authed.post("/internal/validate", requireRole("owner", "admin", "editor"), async (req, res) => {
  const { safeParseFlowDefinition } = await import("@algoverge/core");
  const validation = safeParseFlowDefinition(req.body?.definition);

  const issues: Array<{ severity: string; code: string; message: string; stepId?: string }> = [];
  if (!validation.success) {
    issues.push({
      severity: "error",
      code: "INVALID_FLOW",
      message: validation.error?.message ?? "invalid flow definition",
    });
  }

  res.json({ ok: issues.length === 0, issues });
});

// ============================================================================
// TODOS
// ============================================================================

authed.get("/todos", async (req, res) => {
  const rows = await query(
    `SELECT * FROM todos WHERE org_id = $1 AND status = 'pending' ORDER BY created_at ASC`,
    [req.orgId],
  );
  res.json({ todos: rows });
});

authed.post("/todos/:id/resolve", async (req, res) => {
  const body = z
    .object({ decision: z.enum(["approved", "rejected"]), resolution: z.record(z.unknown()).optional() })
    .parse(req.body);

  const todo = await queryOne<{ id: string; run_id: string; run_created_at: string }>(
    `UPDATE todos SET status = $3, resolution = $4, resolved_at = now()
     WHERE id = $1 AND org_id = $2 AND status = 'pending'
     RETURNING id, run_id, run_created_at`,
    [req.params.id, req.orgId, body.decision, body.resolution ? JSON.stringify(body.resolution) : null],
  );

  if (!todo) return res.status(404).json({ error: "not_found" });

  if (body.decision === "approved") {
    await query(
      `UPDATE flow_runs SET status = 'running', paused_reason = NULL WHERE id = $1 AND org_id = $2 AND status = 'paused'`,
      [todo.run_id, req.orgId],
    );
  }

  res.json({ ok: true });
});

// ============================================================================


// ============================================================================
// USAGE & BILLING
// ============================================================================

authed.get("/usage", async (req, res) => {
  const rows = await query(
    `SELECT counter_key, SUM(value) as total
     FROM usage_counters WHERE org_id = $1
     GROUP BY counter_key`,
    [req.orgId],
  );
  const aiSpend = await queryOne<{ total: number }>(
    `SELECT SUM(cost_usd) as total FROM ai_usage WHERE org_id = $1`,
    [req.orgId],
  );
  res.json({ usage: rows, ai_spend_usd: aiSpend?.total ?? 0 });
});

// ============================================================================
// RUNS/:id/CONTENT/:stepId — signed URL for large payloads
// ============================================================================

authed.get("/runs/:id/content/:stepId", async (req, res) => {
  const step = await queryOne<{ output_json: any; output_ref: string | null }>(
    `SELECT output_json, output_ref FROM run_steps WHERE run_id = $1 AND step_id = $2 AND org_id = $3`,
    [req.params.id, req.params.stepId, req.orgId],
  );
  if (!step) return res.status(404).json({ error: "not_found" });

  if (step.output_ref) {
    // Generate a signed URL for Supabase Storage
    res.json({ url: step.output_ref, expires_in: 3600 });
  } else {
    // Return inline (small payload)
    res.json({ data: step.output_json });
  }
});

// ============================================================================
// MOUNT
// ============================================================================

// ============================================================================
// API KEYS (Part 10)
// ============================================================================

authed.get("/api-keys", async (req, res) => {
  const rows = await query(
    `SELECT id, name, key_prefix, revoked_at, created_at FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC`,
    [req.orgId],
  );
  res.json({ keys: rows });
});

authed.post("/api-keys", async (req, res) => {
  const body = z.object({ name: z.string().min(1) }).parse(req.body);
  const key = crypto.randomBytes(32).toString("hex");
  const prefix = key.slice(0, 8);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO api_keys (org_id, user_id, name, key_prefix, key_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.orgId, req.user!.userId, body.name, prefix, key],
  );
  res.json({ id: row!.id, name: body.name, key_prefix: prefix, secret: key });
});

authed.delete("/api-keys/:id", async (req, res) => {
  await query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND org_id = $2`, [req.params.id, req.orgId]);
  res.json({ ok: true });
});

// ============================================================================
// MCP TOKENS
// ============================================================================

authed.get("/mcp/tokens", async (req, res) => {
  const rows = await query(
    `SELECT id, name, token_prefix, revoked_at, created_at FROM mcp_tokens WHERE org_id = $1 ORDER BY created_at DESC`,
    [req.orgId],
  );
  res.json({ tokens: rows });
});

authed.post("/mcp/tokens", async (req, res) => {
  const body = z.object({ name: z.string().min(1) }).parse(req.body);
  const token = crypto.randomBytes(32).toString("hex");
  const prefix = token.slice(0, 8);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO mcp_tokens (org_id, user_id, name, token_prefix, token_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.orgId, req.user!.userId, body.name, prefix, token],
  );
  res.json({ id: row!.id, name: body.name, token_prefix: prefix, secret: token, endpoint: "/mcp" });
});

authed.delete("/mcp/tokens/:id", async (req, res) => {
  await query(`UPDATE mcp_tokens SET revoked_at = now() WHERE id = $1 AND org_id = $2`, [req.params.id, req.orgId]);
  res.json({ ok: true });
});

// ============================================================================
// WEBHOOK EVENTS
// ============================================================================

authed.get("/webhook-events", async (req, res) => {
  const rows = await query(
    `SELECT id, public_id, processing_status, received_at FROM webhook_events WHERE org_id = $1 ORDER BY received_at DESC LIMIT 50`,
    [req.orgId],
  );
  res.json({ events: rows });
});

// ============================================================================
// APPS (unified piece + operation view for frontend)
// ============================================================================

authed.get("/apps", async (req, res) => {
  const { listCatalogApps } = await import("./catalog/catalog");
  res.json({ apps: listCatalogApps(req.query.q as string | undefined) });
});

authed.get("/apps/:slug", async (req, res) => {
  const { getApp, presentCatalogApp } = await import("./catalog/catalog");
  const app = getApp(req.params.slug);
  if (!app) return res.status(404).json({ error: "not_found" });
  res.json({ app: presentCatalogApp(app) });
});

// ============================================================================
// AUDIT (fix response key for frontend)
// ============================================================================

authed.get("/audit", async (req, res) => {
  const rows = await query(
    `SELECT * FROM audit_logs WHERE org_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [req.orgId],
  );
  res.json({ logs: rows });
});

// ============================================================================
// AUTOMATIONS (frontend uses /automations, backend stores as flows)
// ============================================================================

authed.get("/automations", async (req, res) => {
  const projectId = req.query.projectId as string | undefined;
  let q = `SELECT f.*, fv.version_number as published_version_number
           FROM flows f
           LEFT JOIN flow_versions fv ON fv.id = f.published_version_id
           WHERE f.org_id = $1`;
  const params: unknown[] = [req.orgId];
  if (projectId) {
    q += ` AND f.project_id = $2`;
    params.push(projectId);
  }
  q += ` ORDER BY f.updated_at DESC`;
  const rows = await query(q, params);
  // Map flow status to automation status for frontend
  const automations = rows.map((r: any) => applyAutomationGraphShape(r));
  res.json({ automations });
});

authed.post("/automations", async (req, res) => {
  let projectId: string;
  let flowName: string;
  try {
    const parsed = z.object({
      projectId: z.string().uuid().optional(),
      name: z.string().min(1),
      graph: z.unknown().optional(),
      origin: z.string().optional(),
    }).parse(req.body);
    projectId = parsed.projectId ?? (await ensureProjectId(req.orgId!));
    flowName = parsed.name;
  } catch {
    projectId = await ensureProjectId(req.orgId!);
    flowName = req.body?.name ?? "Untitled automation";
  }

  const baseSlug = flowName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const finalSlug = baseSlug + "-" + Date.now().toString(36);
  const defaultDraft = persistBuilderDraft({
    nodes: [
      { id: "trigger", type: "trigger", appSlug: "", operation: "", label: "Trigger", position: { x: 280, y: 40 }, config: {} },
      { id: "action", type: "action", appSlug: "", operation: "", label: "Action", position: { x: 280, y: 220 }, config: {} },
    ],
    edges: [{ id: "e-trigger-action", source: "trigger", target: "action" }],
  });

  const flow = await queryOne<{ id: string }>(
    `INSERT INTO flows (org_id, project_id, name, slug, origin, created_by, draft_definition)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [req.orgId, projectId, flowName, finalSlug, req.body?.origin === "copilot" ? "copilot" : "manual", req.user!.userId, JSON.stringify(req.body?.graph ? persistBuilderDraft(req.body.graph) : defaultDraft)],
  );
  res.json({ automation: { id: flow!.id, name: flowName, slug: finalSlug } });
});

authed.get("/automations/:id", async (req, res) => {
  const flow = await queryOne(
    `SELECT f.*, fv.definition as published_definition, fv.version_number as published_version_number
     FROM flows f
     LEFT JOIN flow_versions fv ON fv.id = f.published_version_id
     WHERE f.id = $1 AND f.org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!flow) return res.status(404).json({ error: "not_found" });
  const f = flow as any;
  const hook = await queryOne<{ webhook_token: string | null }>(
    `SELECT webhook_token FROM triggers_registry WHERE flow_id = $1 AND status = 'active' LIMIT 1`,
    [f.id],
  );
  res.json({
    automation: {
      id: f.id, name: f.name, status: f.status === "active" ? "on" : f.status === "disabled" ? "off" : "draft",
      slug: f.slug, webhook_public_id: hook?.webhook_token ?? null,
      graph: applyAutomationGraphShape(f).graph,
    },
    graph: applyAutomationGraphShape(f).graph,
    version: f.published_definition ? { graph: applyAutomationGraphShape({ draft_definition: f.published_definition }).graph } : undefined,
  });
});

const updateAutomation = async (req: Request, res: Response) => {
  const body = z.object({
    name: z.string().optional(),
    status: z.string().optional(),
    deleted: z.boolean().optional(),
    graph: z.record(z.unknown()).optional(),
    draft_definition: z.record(z.unknown()).optional(),
  }).parse(req.body);

  if (body.deleted) {
    await query(`DELETE FROM flows WHERE id = $1 AND org_id = $2`, [req.params.id, req.orgId]);
    return res.json({ ok: true });
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 3;
  if (body.name) { sets.push(`name = $${i}`); params.push(body.name); i++; }
  if (body.status) {
    const dbStatus = body.status === "on" ? "active" : body.status === "off" ? "disabled" : body.status;
    sets.push(`status = $${i}`); params.push(dbStatus); i++;
  }
  if (body.graph) { sets.push(`draft_definition = $${i}`); params.push(JSON.stringify(persistBuilderDraft(body.graph))); i++; }
  if (body.draft_definition) {
    const rec = body.draft_definition as Record<string, unknown>;
    const draft = Array.isArray(rec.nodes) ? persistBuilderDraft(rec) : rec;
    sets.push(`draft_definition = $${i}`);
    params.push(JSON.stringify(draft));
    i++;
  }
  if (sets.length === 0) return res.status(400).json({ error: "nothing_to_update" });
  sets.push("updated_at = now()", "updated_by = $" + i); params.push(req.user!.userId);

  await query(`UPDATE flows SET ${sets.join(", ")} WHERE id = $1 AND org_id = $2`, [req.params.id, req.orgId, ...params]);
  res.json({ ok: true });
};

authed.put("/automations/:id", updateAutomation as any);
authed.patch("/automations/:id", updateAutomation as any);

authed.delete("/automations/:id", async (req, res) => {
  await query(`DELETE FROM flows WHERE id = $1 AND org_id = $2`, [req.params.id, req.orgId]);
  res.json({ ok: true });
});

authed.post("/automations/:id/run", async (req, res) => {
  try {
    const flow = await queryOne<{ id: string }>(
      `SELECT id FROM flows WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.orgId],
    );
    if (!flow) return res.status(404).json({ error: "not_found" });

    // Execute workflow — createAndRunFlow creates the run record first, returns ID
    const { createAndRunFlow } = await import("./flow-runtime");
    const exec = await createAndRunFlow({
      orgId: req.orgId!,
      flowId: flow.id,
      userId: req.user!.userId,
      payload: (req.body as any)?.payload ?? { ping: true },
      triggerKind: "manual",
    });
    res.json({ execution: { id: exec.id, status: "started" } });
  } catch (err: any) {
    console.error("POST /automations/:id/run error:", err);
    res.status(500).json({ error: err.message ?? "run_failed" });
  }
});

authed.post("/automations/:id/test-step", async (req, res) => {
  const flow = await queryOne<{ id: string }>(
    `SELECT id FROM flows WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!flow) return res.status(404).json({ error: "not_found" });
  try {
    const body = z.object({ nodeId: z.string().optional(), graph: z.unknown().optional(), inputs: z.record(z.unknown()).default({}) }).parse(req.body);
    // If nodeId is provided, execute the real step via testFlowStep
    if (body.nodeId && body.graph) {
      const { testFlowStep } = await import("./flow-runtime");
      const result = await testFlowStep({ orgId: req.orgId!, flowId: flow.id, nodeId: body.nodeId, graph: body.graph });
      res.json(result);
    } else {
      // Fallback: return inputs as output (backward compat)
      res.json({ ok: true, output: body.inputs, duration_ms: 0, status: "succeeded" });
    }
  } catch (err: any) {
    console.error("POST /automations/:id/test-step error:", err);
    res.status(400).json({ error: err.message ?? "test_step_failed" });
  }
});

authed.post("/automations/:id/publish", async (req, res) => {
  const flow = await queryOne<{ id: string }>(
    `SELECT id FROM flows WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!flow) return res.status(404).json({ error: "not_found" });
  try {
    const { ensureFlowVersion, loadBuilderGraph, persistBuilderDraft } = await import("./flow-runtime");
    const dbFlow = await queryOne<{ id: string; draft_definition: unknown; project_id: string }>(
      `SELECT id, draft_definition, project_id FROM flows WHERE id = $1 AND org_id = $2`,
      [flow.id, req.orgId],
    );
    if (!dbFlow) return res.status(404).json({ error: "not_found" });
    const draft = persistBuilderDraft(loadBuilderGraph(dbFlow.draft_definition));
    const versionId = await ensureFlowVersion({
      orgId: req.orgId!, flowId: dbFlow.id, definition: draft, userId: req.user!.userId,
    });
    await query(`UPDATE flows SET published_version_id = $1, status = 'active', updated_at = now() WHERE id = $2`, [versionId, dbFlow.id]);
    res.json({ ok: true, versionId });
  } catch (err: any) {
    console.error("POST /automations/:id/publish error:", err);
    res.status(500).json({ error: err.message ?? "publish_failed" });
  }
});

authed.post("/automations/:id/validate", async (req, res) => {
  const flow = await queryOne<{ id: string }>(
    `SELECT id FROM flows WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!flow) return res.status(404).json({ error: "not_found" });
  try {
    const { loadBuilderGraph } = await import("./flow-runtime");
    const dbFlow = await queryOne<{ id: string; draft_definition: unknown }>(
      `SELECT id, draft_definition FROM flows WHERE id = $1 AND org_id = $2`,
      [flow.id, req.orgId],
    );
    if (!dbFlow) return res.status(404).json({ error: "not_found" });
    const graph = loadBuilderGraph(dbFlow.draft_definition);
    const issues: Array<{ message: string; severity: string }> = [];
    if (!graph.nodes || graph.nodes.length === 0) {
      issues.push({ message: "No steps in workflow", severity: "error" });
    }
    const hasTrigger = graph.nodes?.some((n: any) => n.type === "trigger");
    if (!hasTrigger) {
      issues.push({ message: "No trigger step found", severity: "warning" });
    }
    res.json({ ok: issues.filter(i => i.severity === "error").length === 0, issues });
  } catch (err: any) {
    console.error("POST /automations/:id/validate error:", err);
    res.status(500).json({ error: err.message ?? "validate_failed" });
  }
});

authed.post("/automations/:id/duplicate", async (req, res) => {
  const flow = await queryOne<{ id: string; name: string; draft_definition: any; project_id: string }>(
    `SELECT id, name, draft_definition, project_id FROM flows WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!flow) return res.status(404).json({ error: "not_found" });
  const slug = flow.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-copy-" + Date.now().toString(36);
  const newFlow = await queryOne<{ id: string }>(
    `INSERT INTO flows (org_id, project_id, name, slug, origin, created_by, draft_definition)
     VALUES ($1, $2, $3, $4, 'manual', $5, $6) RETURNING id`,
    [req.orgId, flow.project_id, flow.name + " (copy)", slug, req.user!.userId, JSON.stringify(flow.draft_definition)],
  );
  res.json({ automation: { id: newFlow!.id } });
});

// ============================================================================
// EXECUTIONS (frontend alias for runs)
// ============================================================================

authed.get("/executions", async (req, res) => {
  const rows = await query(
    `SELECT r.*, f.name as flow_name, f.id as automation_id
     FROM flow_runs r
     JOIN flows f ON f.id = r.flow_id
     WHERE r.org_id = $1
     ORDER BY r.created_at DESC LIMIT 100`,
    [req.orgId],
  );
  const executions = rows.map((r: any) => ({
    id: r.id,
    status: r.status,
    automation_name: r.flow_name,
    automation_id: r.automation_id,
    trigger_type: r.trigger_kind,
    created_at: r.created_at,
    finished_at: r.finished_at,
  }));
  res.json({ executions });
});

// ============================================================================
// APPROVALS (frontend needs this)
// ============================================================================

authed.get("/approvals", async (req, res) => {
  const rows = await query(
    `SELECT t.*, f.name as flow_name
     FROM todos t
     LEFT JOIN flow_runs fr ON t.run_id = fr.id
     LEFT JOIN flows f ON fr.flow_id = f.id
     WHERE t.org_id = $1 AND t.status = 'pending'
     ORDER BY t.created_at DESC`,
    [req.orgId],
  );
  res.json({
    approvals: rows.map((r) => ({
      ...r,
      payload: (r as { payload_json?: unknown }).payload_json ?? (r as { payload?: unknown }).payload,
    })),
  });
});

authed.post("/approvals/:id/decide", async (req, res) => {
  const body = z.object({ decision: z.enum(["approved", "rejected"]) }).parse(req.body);
  const row = await queryOne(
    `UPDATE todos SET status = $3, resolved_at = now(), updated_at = now()
     WHERE id = $1 AND org_id = $2 AND status = 'pending' RETURNING *`,
    [req.params.id, req.orgId, body.decision],
  );
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json({ approval: row });
});

authed.get("/agent-approvals", async (req, res) => {
  const rows = await query(
    `SELECT * FROM workspace_items WHERE org_id = $1 AND kind = 'agent' AND payload->>'pendingApproval' = 'true' ORDER BY created_at DESC`,
    [req.orgId],
  ).catch(() => []);
  res.json({
    approvals: rows.map((r) => ({
      id: r.id,
      app_slug: (r.payload as { appSlug?: string })?.appSlug ?? "agent",
      operation: (r.payload as { operation?: string })?.operation ?? "run",
      created_at: r.created_at,
    })),
  });
});

authed.post("/agent-approvals/:id/decide", async (req, res) => {
  z.object({ decision: z.enum(["approved", "rejected"]) }).parse(req.body);
  await query(
    `UPDATE workspace_items SET payload = payload || jsonb_build_object('pendingApproval', false, 'lastDecision', $3::text), updated_at = now()
     WHERE id = $1 AND org_id = $2 AND kind = 'agent'`,
    [req.params.id, req.orgId, req.body.decision],
  );
  res.json({ ok: true });
});

authed.get("/sdk/apps", async (_req, res) => {
  const { listCatalogApps } = await import("./catalog/catalog");
  res.json({ apps: listCatalogApps() });
});

// ============================================================================
// TEMPLATES
// ============================================================================

authed.get("/templates", async (req, res) => {
  // Return built-in templates
  const templates = [
    {
      slug: "email-to-sheets",
      name: "Log emails to spreadsheet",
      description: "When a new email arrives in Gmail, save the sender, subject, and date to Google Sheets.",
      category: "Email",
      required_apps: ["gmail", "google-sheets"],
      graph: { nodes: [
        { id: "t1", type: "trigger", appSlug: "gmail", operation: "new_email", label: "New email" },
        { id: "a1", type: "action", appSlug: "google-sheets", operation: "create_row", label: "Add row" }
      ], edges: [{ source: "t1", target: "a1" }] },
    },
    {
      slug: "slack-notification",
      name: "Slack channel notification",
      description: "Send a Slack message to a channel when any webhook event arrives.",
      category: "Communication",
      required_apps: ["webhook", "slack"],
      graph: { nodes: [
        { id: "t1", type: "trigger", appSlug: "webhook", operation: "catch_hook", label: "Webhook" },
        { id: "a1", type: "action", appSlug: "slack", operation: "send_message", label: "Send message" }
      ], edges: [{ source: "t1", target: "a1" }] },
    },
    {
      slug: "schedule-report",
      name: "Daily schedule report",
      description: "Every day at 9am, fetch data from an HTTP endpoint and post it to Slack.",
      category: "Scheduling",
      required_apps: ["http", "slack"],
      graph: { nodes: [
        { id: "t1", type: "trigger", appSlug: "schedule", operation: "cron", label: "Every day 9am" },
        { id: "a1", type: "action", appSlug: "http", operation: "request", label: "Fetch data" },
        { id: "a2", type: "action", appSlug: "slack", operation: "send_message", label: "Post to Slack" }
      ], edges: [{ source: "t1", target: "a1" }, { source: "a1", target: "a2" }] },
    },
    {
      slug: "calendar-to-slack",
      name: "Meeting reminder in Slack",
      description: "30 minutes before a Google Calendar event, send a Slack reminder to the team.",
      category: "Scheduling",
      required_apps: ["google-calendar", "slack"],
      graph: { nodes: [
        { id: "t1", type: "trigger", appSlug: "google-calendar", operation: "new_event", label: "New event" },
        { id: "a1", type: "action", appSlug: "slack", operation: "send_message", label: "Slack reminder" }
      ], edges: [{ source: "t1", target: "a1" }] },
    },
    {
      slug: "lead-capture",
      name: "New lead to CRM",
      description: "When a form is submitted, create a contact and send a welcome email.",
      category: "Sales",
      required_apps: ["forms", "gmail"],
      graph: { nodes: [
        { id: "t1", type: "trigger", appSlug: "forms", operation: "submitted", label: "Form submitted" },
        { id: "a1", type: "action", appSlug: "gmail", operation: "send_email", label: "Welcome email" }
      ], edges: [{ source: "t1", target: "a1" }] },
    },
    {
      slug: "webhook-to-http",
      name: "Webhook relay",
      description: "Forward incoming webhook payloads to an external HTTP endpoint.",
      category: "Developer",
      required_apps: ["webhook", "http"],
      graph: { nodes: [
        { id: "t1", type: "trigger", appSlug: "webhook", operation: "catch_hook", label: "Inbound webhook" },
        { id: "a1", type: "action", appSlug: "http", operation: "request", label: "POST request" }
      ], edges: [{ source: "t1", target: "a1" }] },
    },
    {
      slug: "gmail-to-sheets",
      name: "Gmail to Sheets",
      description: "When a new Gmail arrives, append sender, subject, and snippet to Google Sheets.",
      category: "Email",
      required_apps: ["gmail", "google-sheets"],
      graph: { nodes: [
        { id: "t1", type: "trigger", appSlug: "gmail", operation: "new_email", label: "New Gmail", position: { x: 280, y: 40 } },
        { id: "a1", type: "action", appSlug: "google-sheets", operation: "create_row", label: "Add row", position: { x: 280, y: 220 } }
      ], edges: [{ id: "e1", source: "t1", target: "a1" }] },
    },
    {
      slug: "manual-http",
      name: "Manual HTTP call",
      description: "Click run in the builder to POST JSON to any URL.",
      category: "Developer",
      required_apps: ["manual", "http"],
      graph: { nodes: [
        { id: "t1", type: "trigger", appSlug: "manual", operation: "button", label: "Manual", position: { x: 280, y: 40 } },
        { id: "a1", type: "action", appSlug: "http", operation: "request", label: "HTTP request", position: { x: 280, y: 220 } }
      ], edges: [{ id: "e1", source: "t1", target: "a1" }] },
    },
    {
      slug: "filter-then-slack",
      name: "Filter then Slack",
      description: "When a webhook arrives, only continue if the payload matches, then notify Slack.",
      category: "Logic",
      required_apps: ["webhook", "filter", "slack"],
      graph: { nodes: [
        { id: "t1", type: "trigger", appSlug: "webhook", operation: "catch_hook", label: "Catch Hook", position: { x: 280, y: 40 } },
        { id: "a1", type: "logic", appSlug: "filter", operation: "only_continue_if", label: "Only continue if", position: { x: 280, y: 200 } },
        { id: "a2", type: "action", appSlug: "slack", operation: "send_message", label: "Send Slack", position: { x: 280, y: 360 } }
      ], edges: [{ id: "e1", source: "t1", target: "a1" }, { id: "e2", source: "a1", target: "a2" }] },
    },
    {
      slug: "schedule-digest",
      name: "Daily digest",
      description: "Every morning, delay 5 minutes then POST a summary over HTTP.",
      category: "Scheduling",
      required_apps: ["schedule", "delay", "http"],
      graph: { nodes: [
        { id: "t1", type: "trigger", appSlug: "schedule", operation: "cron", label: "Every day 9am", position: { x: 280, y: 40 } },
        { id: "a1", type: "logic", appSlug: "delay", operation: "for", label: "Delay", position: { x: 280, y: 200 } },
        { id: "a2", type: "action", appSlug: "http", operation: "request", label: "HTTP", position: { x: 280, y: 360 } }
      ], edges: [{ id: "e1", source: "t1", target: "a1" }, { id: "e2", source: "a1", target: "a2" }] },
    },
    {
      slug: "form-to-sheets",
      name: "Form to Sheets",
      description: "When a form is submitted, add a Google Sheets row.",
      category: "Data",
      required_apps: ["forms", "google-sheets"],
      graph: { nodes: [
        { id: "t1", type: "trigger", appSlug: "forms", operation: "submitted", label: "Form submitted", position: { x: 280, y: 40 } },
        { id: "a1", type: "action", appSlug: "google-sheets", operation: "create_row", label: "Add row", position: { x: 280, y: 220 } }
      ], edges: [{ id: "e1", source: "t1", target: "a1" }] },
    },
    {
      slug: "rss-to-slack",
      name: "RSS to Slack",
      description: "When a new RSS item appears, post it to Slack.",
      category: "Social",
      required_apps: ["rss", "slack"],
      graph: { nodes: [
        { id: "t1", type: "trigger", appSlug: "rss", operation: "new_item", label: "New RSS item", position: { x: 280, y: 40 } },
        { id: "a1", type: "action", appSlug: "slack", operation: "send_message", label: "Send Slack", position: { x: 280, y: 220 } }
      ], edges: [{ id: "e1", source: "t1", target: "a1" }] },
    },
  ];
  res.json({ templates });
});

authed.post("/templates/:slug/use", async (req, res) => {
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE org_id = $1 LIMIT 1`, [req.orgId]);
  const slug = "template-" + Date.now().toString(36);
  const name = String(req.body?.name ?? "From template");
  const draft = persistBuilderDraft(req.body?.graph ?? {
    nodes: [
      { id: "trigger", type: "trigger", appSlug: "webhook", operation: "catch_hook", label: "Catch Hook", position: { x: 280, y: 40 }, config: {} },
      { id: "action", type: "action", appSlug: "http", operation: "request", label: "HTTP", position: { x: 280, y: 220 }, config: {} },
    ],
    edges: [{ id: "e-trigger-action", source: "trigger", target: "action" }],
  });
  const flow = await queryOne<{ id: string }>(
    `INSERT INTO flows (org_id, project_id, name, slug, origin, created_by, draft_definition)
     VALUES ($1, $2, $3, $4, 'template', $5, $6) RETURNING id`,
    [req.orgId, proj!.id, name, slug, req.user!.userId, JSON.stringify(draft)],
  );
  res.json({ automation: { id: flow!.id } });
});

// ============================================================================
// TABLES (Data Tables)
// ============================================================================

authed.get("/tables", async (req, res) => {
  const rows = await query(
    `SELECT * FROM data_tables WHERE org_id = $1 AND name NOT LIKE 'form:%' ORDER BY created_at DESC`,
    [req.orgId],
  );
  res.json({ tables: rows });
});

authed.post("/tables", async (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    schema: z.record(z.unknown()).optional(),
  }).parse(req.body);
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE org_id = $1 LIMIT 1`, [req.orgId]);
  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO data_tables (org_id, project_id, name, slug, schema_json) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.orgId, proj!.id, body.name, slug, body.schema ? JSON.stringify(body.schema) : '{"fields": []}'],
  );
  res.json({ table: { id: row!.id, name: body.name } });
});

authed.get("/tables/:id", async (req, res) => {
  const row = await queryOne(`SELECT * FROM data_tables WHERE id = $1 AND org_id = $2`, [req.params.id, req.orgId]);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json({ table: row });
});

authed.delete("/tables/:id", async (req, res) => {
  await query(`DELETE FROM data_table_rows WHERE table_id = $1 AND org_id = $2`, [req.params.id, req.orgId]);
  await query(`DELETE FROM data_tables WHERE id = $1 AND org_id = $2`, [req.params.id, req.orgId]);
  res.json({ ok: true });
});

authed.patch("/tables/:id", async (req, res) => {
  const body = z.object({ schema: z.record(z.unknown()).optional(), name: z.string().optional() }).parse(req.body);
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 3;
  if (body.schema) { sets.push(`schema_json = $${i}`); params.push(JSON.stringify(body.schema)); i++; }
  if (body.name) { sets.push(`name = $${i}`); params.push(body.name); i++; }
  if (sets.length === 0) return res.status(400).json({ error: "nothing_to_update" });
  await query(`UPDATE data_tables SET ${sets.join(", ")} WHERE id = $1 AND org_id = $2`, [req.params.id, req.orgId, ...params]);
  res.json({ ok: true });
});

authed.get("/tables/:id/records", async (req, res) => {
  const rows = await query(
    `SELECT * FROM data_table_rows WHERE table_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 200`,
    [req.params.id, req.orgId],
  );
  res.json({ records: rows });
});

authed.post("/tables/:id/records", async (req, res) => {
  const body = z.object({ data: z.record(z.unknown()) }).parse(req.body);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO data_table_rows (org_id, table_id, data) VALUES ($1, $2, $3) RETURNING id`,
    [req.orgId, req.params.id, JSON.stringify(body.data)],
  );
  res.json({ record: { id: row!.id, data: body.data } });
});

authed.delete("/tables/:id/records/:recordId", async (req, res) => {
  await query(
    `DELETE FROM data_table_rows WHERE id = $1 AND table_id = $2 AND org_id = $3`,
    [req.params.recordId, req.params.id, req.orgId],
  );
  res.json({ ok: true });
});

// ============================================================================
// ORGANIZATION & WORKSPACE
// ============================================================================

authed.get("/organization", async (req, res) => {
  const org = await queryOne(`SELECT * FROM organizations WHERE id = $1`, [req.orgId]);
  const members = await query(
    `SELECT om.*, u.email, u.full_name FROM org_members om JOIN users u ON u.id = om.user_id WHERE om.org_id = $1`,
    [req.orgId],
  );
  res.json({ organization: org, members });
});

authed.patch("/organization", async (req, res) => {
  const body = z.object({ name: z.string().min(1) }).parse(req.body);
  await query(`UPDATE organizations SET name = $2, updated_at = now() WHERE id = $1`, [req.orgId, body.name]);
  res.json({ ok: true });
});

authed.get("/organization/members", async (req, res) => {
  const rows = await query(
    `SELECT om.*, u.email, u.full_name FROM org_members om JOIN users u ON u.id = om.user_id WHERE om.org_id = $1`,
    [req.orgId],
  );
  res.json({ members: rows });
});

authed.post("/organization/members", async (req, res) => {
  const body = z.object({ email: z.string().email(), role: z.string().default("member") }).parse(req.body);
  const user = await queryOne<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [body.email.toLowerCase()]);
  if (!user) return res.status(404).json({ error: "user_not_found", hint: "User must have an Orchestra account first." });
  await query(
    `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (org_id, user_id) DO UPDATE SET role = $3`,
    [req.orgId, user.id, body.role],
  );
  res.json({ ok: true });
});

authed.get("/workspaces", async (req, res) => {
  const rows = await query(
    `SELECT o.id, o.name, o.slug FROM organizations o
     JOIN org_members om ON om.org_id = o.id
     WHERE om.user_id = $1`,
    [req.user!.userId],
  );
  res.json({ workspaces: rows });
});

authed.post("/workspaces", async (req, res) => {
  const body = z.object({ name: z.string().min(1) }).parse(req.body);
  const slug = `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${crypto.randomBytes(3).toString("hex")}`;
  const org = await queryOne<{ id: string; name: string; slug: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name, slug`,
    [body.name, slug],
  );
  await query(`INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [org!.id, req.user!.userId]);
  await query(`INSERT INTO projects (org_id, name, slug) VALUES ($1, 'Main', 'main')`, [org!.id]);
  res.json({ workspace: org });
});

// ============================================================================
// VARIABLES
// ============================================================================

// Note: We store variables in a JSONB column on organizations for simplicity
// In production this would be a separate table
authed.get("/variables", async (req, res) => {
  const org = await queryOne<{ settings?: { variables?: Record<string, unknown> } }>(
    `SELECT settings FROM organizations WHERE id = $1`,
    [req.orgId],
  );
  const vars = org?.settings?.variables ?? {};
  const variables = Object.entries(vars).map(([key, value]) => ({ id: key, key, value: String(value) }));
  res.json({ variables });
});

authed.put("/variables", async (req, res) => {
  const body = z.object({ key: z.string().min(1), value: z.string() }).parse(req.body);
  const org = await queryOne<{ settings?: Record<string, unknown> }>(`SELECT settings FROM organizations WHERE id = $1`, [req.orgId]);
  const settings = { ...(org?.settings ?? {}) };
  const vars = { ...((settings.variables as Record<string, unknown>) ?? {}) };
  vars[body.key] = body.value;
  settings.variables = vars;
  await query(`UPDATE organizations SET settings = $2, updated_at = now() WHERE id = $1`, [req.orgId, JSON.stringify(settings)]);
  res.json({ ok: true });
});

// ============================================================================
// FORMS
// ============================================================================

authed.get("/forms", async (req, res) => {
  // Store forms in data_tables with a 'form' prefix for simplicity
  const rows = await query(
    `SELECT * FROM data_tables WHERE org_id = $1 AND name LIKE 'form:%' ORDER BY created_at DESC`,
    [req.orgId],
  );
  const forms = rows.map((r: any) => ({
    id: r.id,
    name: (r.name ?? '').replace(/^form:/, ''),
    slug: r.slug ?? r.id.slice(0, 8),
    fields: r.schema_json?.fields ?? [],
    table_id: r.schema_json?.table_id ?? null,
    automation_id: r.schema_json?.automation_id ?? null,
  }));
  res.json({ forms });
});

authed.post("/forms", async (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    slug: z.string().optional(),
    fields: z.array(z.object({ key: z.string(), type: z.string(), label: z.string() })).default([]),
    tableId: z.string().uuid().optional(),
    automationId: z.string().uuid().optional(),
  }).parse(req.body);
  const proj = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE org_id = $1 LIMIT 1`, [req.orgId]);
  const slug = body.slug ?? body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const row = await queryOne<{ id: string }>(
    `INSERT INTO data_tables (org_id, project_id, name, slug, schema_json)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [req.orgId, proj!.id, `form:${body.name}`, slug, JSON.stringify({ fields: body.fields, table_id: body.tableId, automation_id: body.automationId })],
  );
  res.json({ form: { id: row!.id, name: body.name } });
});

authed.patch("/forms/:id", async (req, res) => {
  const body = z.object({
    name: z.string().min(1).optional(),
    tableId: z.string().uuid().nullable().optional(),
    automationId: z.string().uuid().nullable().optional(),
    fields: z.array(z.object({ key: z.string(), type: z.string(), label: z.string() })).optional(),
  }).parse(req.body);

  const existing = await queryOne<{ id: string; schema_json: Record<string, unknown> }>(
    `SELECT id, schema_json FROM data_tables WHERE id = $1 AND org_id = $2 AND name LIKE 'form:%'`,
    [req.params.id, req.orgId],
  );
  if (!existing) return res.status(404).json({ error: "not_found" });

  const schema = { ...existing.schema_json } as Record<string, unknown>;
  if (body.tableId !== undefined) schema.table_id = body.tableId;
  if (body.automationId !== undefined) schema.automation_id = body.automationId;
  if (body.fields) schema.fields = body.fields;

  const updates: string[] = [];
  const params: unknown[] = [];
  let idx = 3;
  if (body.name) { updates.push(`name = $${idx}`); params.push(`form:${body.name}`); idx++; }
  updates.push(`schema_json = $${idx}`); params.push(JSON.stringify(schema));

  await query(`UPDATE data_tables SET ${updates.join(', ')} WHERE id = $1 AND org_id = $2`, [req.params.id, req.orgId, ...params]);
  res.json({ ok: true });
});

authed.delete("/forms/:id", async (req, res) => {
  await query(`DELETE FROM data_tables WHERE id = $1 AND org_id = $2 AND name LIKE 'form:%'`, [req.params.id, req.orgId]);
  res.json({ ok: true });
});

authed.get("/forms/:id/submissions", async (req, res) => {
  // Form submissions are stored as data_table_rows
  const rows = await query(
    `SELECT * FROM data_table_rows WHERE table_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 100`,
    [req.params.id, req.orgId],
  );
  res.json({ submissions: rows.map((r: any) => ({ id: r.id, data: r.data, created_at: r.created_at })) });
});

// ============================================================================
// BILLING
// ============================================================================

authed.get("/billing", async (req, res) => {
  const usage = await query(
    `SELECT counter_key as metric, SUM(value) as quantity FROM usage_counters WHERE org_id = $1 GROUP BY counter_key`,
    [req.orgId],
  );
  res.json({
    plan: "free",
    stripeConfigured: false,
    plans: [
      { slug: "free", name: "Free", monthly_price_cents: 0, task_limit: 100 },
      { slug: "professional", name: "Professional", monthly_price_cents: 2900, task_limit: 10000 },
      { slug: "team", name: "Team", monthly_price_cents: 9900, task_limit: 50000 },
      { slug: "business", name: "Business", monthly_price_cents: 29900, task_limit: null },
    ],
    usage,
  });
});

authed.post("/billing/checkout", async (req, res) => {
  res.status(400).json({ error: "stripe_not_configured", hint: "Configure Stripe keys in your environment to enable billing." });
});

// ============================================================================
// INTERFACES / CHATBOTS / AGENTS / CANVAS (workspace_items)
// ============================================================================

function presentItem(row: Record<string, unknown>) {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return { id: row.id, name: row.name, created_at: row.created_at, updated_at: row.updated_at, ...payload };
}

async function listItems(orgId: string, kind: string) {
  return query(`SELECT * FROM workspace_items WHERE org_id = $1 AND kind = $2 ORDER BY updated_at DESC`, [orgId, kind]);
}

async function insertItem(orgId: string, kind: string, name: string, payload: Record<string, unknown>) {
  return queryOne(
    `INSERT INTO workspace_items (org_id, kind, name, payload) VALUES ($1,$2,$3,$4) RETURNING *`,
    [orgId, kind, name, JSON.stringify(payload)],
  );
}

authed.get("/interfaces", async (req, res) => {
  const rows = await listItems(req.orgId!, "interface");
  res.json({ interfaces: rows.map(presentItem) });
});

authed.post("/interfaces", async (req, res) => {
  const body = z.object({ name: z.string(), isPublic: z.boolean().optional(), pages: z.array(z.record(z.unknown())).optional() }).parse(req.body);
  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const row = await insertItem(req.orgId!, "interface", body.name, {
    slug,
    pages: body.pages ?? [],
    is_public: body.isPublic ?? true,
  });
  res.json({ interface: presentItem(row!) });
});

authed.delete("/interfaces/:id", async (req, res) => {
  await query(`DELETE FROM workspace_items WHERE id = $1 AND org_id = $2 AND kind = 'interface'`, [req.params.id, req.orgId]);
  res.json({ ok: true });
});

authed.get("/chatbots", async (req, res) => {
  const rows = await listItems(req.orgId!, "chatbot");
  res.json({ chatbots: rows.map(presentItem) });
});

authed.post("/chatbots", async (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    instructions: z.string().optional(),
    knowledge: z.string().optional(),
    keyword: z.string().optional(),
    automationId: z.string().uuid().optional(),
  }).parse(req.body);
  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const row = await insertItem(req.orgId!, "chatbot", body.name, { ...body, slug, activities: [] });
  res.json({ chatbot: presentItem(row!) });
});

authed.delete("/chatbots/:id", async (req, res) => {
  await query(`DELETE FROM workspace_items WHERE id = $1 AND org_id = $2 AND kind = 'chatbot'`, [req.params.id, req.orgId]);
  res.json({ ok: true });
});

authed.post("/chatbots/:id/chat", async (req, res) => {
  const body = z.object({ message: z.string().min(1) }).parse(req.body);
  const bot = await queryOne(`SELECT * FROM workspace_items WHERE id = $1 AND org_id = $2 AND kind = 'chatbot'`, [req.params.id, req.orgId]);
  const instructions = String((bot?.payload as { instructions?: string })?.instructions ?? "");
  const result = await copilotChat({
    prompt: `${instructions}\n\nUser: ${body.message}`,
    workspaceId: req.orgId,
  } as any).catch(() => null);
  const reply = result?.reply ?? result?.summary ?? `I received: "${body.message}". Connect an AI provider key for a live answer.`;
  res.json({ reply });
});

authed.get("/agents", async (req, res) => {
  const rows = await listItems(req.orgId!, "agent");
  res.json({ agents: rows.map((r) => ({ ...presentItem(r), status: (r.payload as { status?: string })?.status ?? "active" })) });
});

authed.post("/agents", async (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    instructions: z.string().optional(),
    knowledge: z.string().optional(),
    pod: z.string().optional(),
    automationId: z.string().uuid().optional(),
    tools: z.array(z.record(z.unknown())).optional(),
    approvalRequired: z.boolean().optional(),
  }).parse(req.body);
  const row = await insertItem(req.orgId!, "agent", body.name, { ...body, status: "active", activities: [] });
  res.json({ agent: presentItem(row!) });
});

authed.delete("/agents/:id", async (req, res) => {
  await query(`DELETE FROM workspace_items WHERE id = $1 AND org_id = $2 AND kind = 'agent'`, [req.params.id, req.orgId]);
  res.json({ ok: true });
});

authed.post("/agents/:id/run", async (req, res) => {
  const body = z.object({ message: z.string().min(1) }).parse(req.body);
  const agent = await queryOne(`SELECT * FROM workspace_items WHERE id = $1 AND org_id = $2 AND kind = 'agent'`, [req.params.id, req.orgId]);
  if (!agent) return res.status(404).json({ error: "not_found" });
  const payload = (agent.payload ?? {}) as Record<string, unknown>;
  const result = await copilotChat({
    prompt: `${payload.instructions ?? ""}\n\nEvent: ${body.message}`,
    workspaceId: req.orgId,
  } as any).catch(() => null);
  const reply = result?.reply ?? result?.summary ?? `Agent noted: "${body.message}".`;
  const activities = Array.isArray(payload.activities) ? payload.activities : [];
  activities.unshift({ id: crypto.randomUUID(), message: body.message, reply, created_at: new Date().toISOString() });
  await query(`UPDATE workspace_items SET payload = $3, updated_at = now() WHERE id = $1 AND org_id = $2`, [
    req.params.id,
    req.orgId,
    JSON.stringify({ ...payload, activities: activities.slice(0, 50) }),
  ]);
  const automationId = typeof payload.automationId === "string" ? payload.automationId : undefined;
  if (automationId) {
    const { createAndRunFlow } = await import("./flow-runtime");
    await createAndRunFlow({
      orgId: req.orgId!,
      flowId: automationId,
      userId: req.user!.userId,
      payload: { message: body.message, reply },
      triggerKind: "agent",
    }).catch(() => undefined);
  }
  res.json({ reply });
});

authed.get("/agents/:id/activities", async (req, res) => {
  const agent = await queryOne(`SELECT payload FROM workspace_items WHERE id = $1 AND org_id = $2 AND kind = 'agent'`, [req.params.id, req.orgId]);
  const activities = ((agent?.payload as { activities?: unknown[] })?.activities) ?? [];
  res.json({ activities });
});

authed.post("/ai/copilot", async (req, res) => {
  const body = z.object({ prompt: z.string().min(1), mode: z.string().optional(), graph: z.unknown().optional() }).parse(req.body);
  let engineResult: { graph: unknown; summary: string; source: string; rebuilt?: boolean; changed?: boolean } | undefined;
  for await (const ev of runCopilotEngine({
    prompt: body.prompt,
    workspaceId: req.orgId,
    userEmail: req.user?.email,
    mode: (body.mode as "auto_build" | "ask_as_you_build") ?? "auto_build",
    graph: body.graph as any,
  })) {
    if (ev.type === "result") {
      engineResult = ev.result;
    }
  }
  if (engineResult) {
    return res.json({
      graph: engineResult.graph,
      summary: engineResult.summary,
      source: engineResult.source,
      rebuilt: engineResult.rebuilt,
      changed: engineResult.changed,
    });
  }
  const result = await copilotGraph(body.prompt, req.orgId, {
    userEmail: req.user?.email,
    mode: body.mode as any,
    graph: body.graph as any,
  });
  res.json({ graph: result.graph, summary: result.summary, source: result.source });
});

/** Simple AI text generation for table AI fields */
authed.post("/ai/generate", async (req, res) => {
  const body = z.object({ prompt: z.string().min(1) }).parse(req.body);
  const ai = await probeAiService();
  if (ai.reachable) {
    try {
      const result = await signedAiJson<{ text?: string; content?: string }>("/generate", { prompt: body.prompt }, req.orgId!);
      return res.json({ text: result?.text ?? result?.content ?? "Generated content" });
    } catch { /* fall through */ }
  }
  // Fallback: generate placeholder text based on the prompt
  res.json({ text: `[AI] ${body.prompt.slice(0, 200)}` });
});

authed.get("/canvases", async (req, res) => {
  const rows = await listItems(req.orgId!, "canvas");
  res.json({ canvases: rows.map((r) => ({ ...presentItem(r), graph: (r.payload as { graph?: unknown })?.graph ?? { nodes: [], edges: [] } })) });
});

authed.post("/canvases", async (req, res) => {
  const body = z.object({ name: z.string().min(1), sourceAutomationId: z.string().uuid().optional(), graph: z.unknown().optional() }).parse(req.body);
  let graph = body.graph as { nodes?: unknown[]; edges?: unknown[] } | undefined;
  if (body.sourceAutomationId) {
    const flow = await queryOne<{ draft_definition: unknown }>(
      `SELECT draft_definition FROM flows WHERE id = $1 AND org_id = $2`,
      [body.sourceAutomationId, req.orgId],
    );
    if (flow?.draft_definition) {
      const g = loadBuilderGraph(flow.draft_definition);
      graph = {
        nodes: (g.nodes ?? []).map((n, i) => ({
          id: n.id,
          label: n.label || n.appSlug || n.id,
          kind: n.type,
          appSlug: n.appSlug,
          operation: n.operation,
          x: n.position?.x ?? 80,
          y: n.position?.y ?? 40 + i * 160,
        })),
        edges: (g.edges ?? []).map((e) => ({ id: e.id, source: e.source, target: e.target })),
      };
    }
  }
  if (!graph?.nodes?.length) {
    graph = {
      nodes: [
        { id: "trigger", label: "Trigger", kind: "trigger", x: 80, y: 40 },
        { id: "action", label: "Action", kind: "action", x: 80, y: 200 },
      ],
      edges: [{ id: "e1", source: "trigger", target: "action" }],
    };
  }
  const row = await insertItem(req.orgId!, "canvas", body.name, { graph, sourceAutomationId: body.sourceAutomationId });
  res.json({ canvas: { ...presentItem(row!), graph } });
});

authed.patch("/canvases/:id", async (req, res) => {
  const body = z.object({ name: z.string().optional(), graph: z.record(z.unknown()).optional() }).parse(req.body);
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 3;
  if (body.name) { sets.push(`name = $${idx}`); params.push(body.name); idx++; }
  if (body.graph) { sets.push(`payload = jsonb_set(COALESCE(payload, '{}'), '{graph}', $${idx}::jsonb)`); params.push(JSON.stringify(body.graph)); idx++; }
  if (sets.length === 0) return res.status(400).json({ error: "nothing_to_update" });
  await query(`UPDATE workspace_items SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND org_id = $2 AND kind = 'canvas'`, [req.params.id, req.orgId, ...params]);
  res.json({ ok: true });
});

authed.delete("/canvases/:id", async (req, res) => {
  await query(`DELETE FROM workspace_items WHERE id = $1 AND org_id = $2 AND kind = 'canvas'`, [req.params.id, req.orgId]);
  res.json({ ok: true });
});

// ============================================================================
// FOLDERS
// ============================================================================

authed.get("/folders", async (req, res) => {
  const rows = await query(`SELECT * FROM automation_folders WHERE org_id = $1 ORDER BY name`, [req.orgId]).catch(() => []);
  res.json({ folders: rows });
});

authed.post("/folders", async (req, res) => {
  const body = z.object({ name: z.string().min(1), parentId: z.string().uuid().optional() }).parse(req.body);
  const row = await queryOne(
    `INSERT INTO automation_folders (org_id, name, parent_id) VALUES ($1, $2, $3) RETURNING *`,
    [req.orgId, body.name, body.parentId ?? null],
  );
  res.json({ folder: row });
});

// ============================================================================
// MOUNT
// ============================================================================

router.post("/internal/validate", serviceAuthMiddleware, async (req, res) => {
  const def = req.body?.definition;
  if (def && Array.isArray(def.nodes)) {
    return res.json({ ok: true, issues: [] });
  }
  const { safeParseFlowDefinition } = await import("@algoverge/core");
  const validation = safeParseFlowDefinition(def);
  const issues: Array<{ severity: string; code: string; message: string }> = [];
  if (!validation.success) {
    issues.push({
      severity: "error",
      code: "INVALID_FLOW",
      message: validation.error?.message ?? "invalid flow definition",
    });
  }
  res.json({ ok: issues.length === 0, issues });
});

router.post("/internal/connections/lookup", serviceAuthMiddleware, async (req, res) => {
  const piece = String(req.body?.piece ?? "");
  const { pickForCopilot } = await import("./connections");
  const picked = await pickForCopilot({ workspaceId: req.orgId!, pieceName: piece });
  res.json({
    connections: picked.connectionId
      ? [{ id: picked.connectionId, display_name: picked.label, piece_name: piece }]
      : [],
  });
});

router.post("/internal/execute-tool", serviceAuthMiddleware, async (req, res) => {
  const body = z
    .object({
      operation_id: z.string(),
      connection_id: z.string().uuid().nullable().optional(),
      arguments: z.record(z.unknown()),
      run_id: z.string(),
      step_id: z.string(),
      nonce: z.string(),
    })
    .parse(req.body);
  const used = await queryOne(`SELECT id FROM run_steps WHERE effect_key = $1`, [body.nonce]);
  if (used) return res.status(409).json({ ok: false, code: "NONCE_REUSED" });
  try {
    const { runAdapter } = await import("./adapters");
    const auth = body.connection_id ? await loadConnectionAuth(body.connection_id, req.orgId!) : null;
    const result = await runAdapter({
      appSlug: body.operation_id.split(":")[0],
      operation: body.operation_id.split(":")[2] ?? body.operation_id,
      input: body.arguments,
      auth,
      workspaceId: req.orgId!,
      executionId: body.run_id,
      connectionId: body.connection_id ?? undefined,
    });
    res.json({ ok: true, output: result.output });
  } catch (err) {
    res.json({ ok: false, code: "FATAL", message: err instanceof Error ? err.message : "tool execution failed" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Asset Registry — Unified product model
// ═══════════════════════════════════════════════════════════════════════════

authed.get("/assets", async (req, res) => {
  const { type, status, folder_id, search, limit: lim } = req.query as Record<string, string>;
  let sql = `SELECT a.*, f.name as folder_name
    FROM public.assets a
    LEFT JOIN public.folders f ON f.id = a.folder_id
    WHERE a.org_id = $1`;
  const params: any[] = [req.orgId!];
  let idx = 2;
  if (type) { sql += ` AND a.type = $${idx++}`; params.push(type); }
  if (status) { sql += ` AND a.status = $${idx++}`; params.push(status); }
  if (folder_id) { sql += ` AND a.folder_id = $${idx++}`; params.push(folder_id); }
  if (search) { sql += ` AND a.name ILIKE $${idx++}`; params.push(`%${search}%`); }
  sql += ` ORDER BY a.updated_at DESC LIMIT $${idx}`;
  params.push(Number(lim) || 100);
  const rows = await query<any>(sql, params);
  res.json({ assets: rows, total: rows.length });
});

authed.get("/assets/:id", async (req, res) => {
  const asset = await queryOne(`SELECT * FROM public.assets WHERE id = $1 AND org_id = $2`, [req.params.id, req.orgId!]);
  if (!asset) return res.status(404).json({ error: "not found" });
  const relations = await query(`SELECT ar.*, a.name as target_name, a.type as target_type, a.slug as target_slug
    FROM public.asset_relations ar
    JOIN public.assets a ON a.id = ar.target_asset_id
    WHERE ar.source_asset_id = $1`, [req.params.id]);
  res.json({ asset, relations });
});

authed.post("/assets", async (req, res) => {
  const body = z.object({
    type: z.enum(["workflow", "table", "form", "interface", "canvas", "agent", "chatbot"]),
    name: z.string().min(1),
    slug: z.string().min(1),
    description: z.string().optional(),
    folder_id: z.string().uuid().nullable().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
  }).parse(req.body);
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO public.assets (id, org_id, type, name, slug, description, folder_id, tags, metadata, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, req.orgId!, body.type, body.name, body.slug, body.description ?? null, body.folder_id ?? null, body.tags ?? [], body.metadata ?? {}, req.user?.userId ?? null],
  );
  const asset = await queryOne(`SELECT * FROM public.assets WHERE id = $1`, [id]);
  res.status(201).json({ asset });
});

authed.patch("/assets/:id", async (req, res) => {
  const body = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.enum(["draft", "active", "paused", "disabled", "archived"]).optional(),
    folder_id: z.string().uuid().nullable().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
  }).parse(req.body);
  const sets: string[] = [`updated_at = now()`];
  const params: any[] = [];
  let idx = 1;
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    sets.push(`${k} = $${idx++}`);
    params.push(k === "tags" ? v : typeof v === "object" ? JSON.stringify(v) : v);
  }
  params.push(req.params.id, req.orgId!);
  await query(`UPDATE public.assets SET ${sets.join(", ")} WHERE id = $${idx++} AND org_id = $${idx}`, params);
  const asset = await queryOne(`SELECT * FROM public.assets WHERE id = $1`, [req.params.id]);
  res.json({ asset });
});

authed.delete("/assets/:id", async (req, res) => {
  await query(`DELETE FROM public.assets WHERE id = $1 AND org_id = $2`, [req.params.id, req.orgId!]);
  res.json({ ok: true });
});

authed.post("/assets/:id/relations", async (req, res) => {
  const body = z.object({
    target_asset_id: z.string().uuid(),
    relation_type: z.enum(["triggers", "depends_on", "calls", "reads_from", "writes_to", "embeds", "contains", "notifies", "approves", "uses", "generates"]),
    metadata: z.record(z.unknown()).optional(),
  }).parse(req.body);
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO public.asset_relations (id, source_asset_id, target_asset_id, relation_type, metadata)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (source_asset_id, target_asset_id, relation_type) DO NOTHING`,
    [id, req.params.id, body.target_asset_id, body.relation_type, body.metadata ?? {}],
  );
  res.status(201).json({ ok: true, id });
});

authed.get("/assets/:id/graph", async (req, res) => {
  const asset = await queryOne(`SELECT * FROM public.assets WHERE id = $1 AND org_id = $2`, [req.params.id, req.orgId!]);
  if (!asset) return res.status(404).json({ error: "not found" });
  const nodes = [asset];
  const edges = await query(
    `SELECT ar.*, a.name as target_name, a.type as target_type, a.slug as target_slug
     FROM public.asset_relations ar
     JOIN public.assets a ON a.id = ar.target_asset_id
     WHERE ar.source_asset_id = $1`, [req.params.id]);
  res.json({ nodes, edges });
});

// NOTE: Folders routes live earlier in this file (line ~2478)
// The asset-registry public.folders routes were removed as duplicates.

// ─── Notifications ─────────────────────────────────────────────────────────

authed.get("/notifications", async (req, res) => {
  const { unread_only, limit: lim } = req.query as Record<string, string>;
  let sql = `SELECT * FROM public.notifications WHERE user_id = $1`;
  const params: any[] = [req.user?.userId ?? ""];
  let idx = 2;
  if (unread_only === "true") { sql += ` AND read = false`; }
  sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
  params.push(Number(lim) || 50);
  const rows = await query<any>(sql, params);
  const unread = await queryOne<{ count: string }>(
    `SELECT count(*)::int as count FROM public.notifications WHERE user_id = $1 AND read = false`,
    [req.user?.userId ?? ""],
  );
  res.json({ notifications: rows, unread_count: Number(unread?.count ?? 0) });
});

authed.patch("/notifications/:id/read", async (req, res) => {
  await query(`UPDATE public.notifications SET read = true, read_at = now() WHERE id = $1 AND user_id = $2`, [req.params.id, req.user?.userId ?? ""]);
  res.json({ ok: true });
});

authed.post("/notifications/mark-all-read", async (req, res) => {
  await query(`UPDATE public.notifications SET read = true, read_at = now() WHERE user_id = $1 AND read = false`, [req.user?.userId ?? ""]);
  res.json({ ok: true });
});

// NOTE: Approvals routes live earlier in this file (line ~1831)
// The asset-registry approval_requests table routes were removed as duplicates.

// ─── Knowledge ─────────────────────────────────────────────────────────────

authed.get("/knowledge", async (req, res) => {
  const rows = await query(`SELECT * FROM public.knowledge_sources WHERE org_id = $1 ORDER BY created_at DESC`, [req.orgId!]);
  res.json({ knowledge: rows });
});

authed.post("/knowledge", async (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    type: z.enum(["file", "url", "table", "document", "text"]),
    content: z.string().optional(),
    url: z.string().optional(),
    table_id: z.string().uuid().optional(),
    metadata: z.record(z.unknown()).optional(),
  }).parse(req.body);
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO public.knowledge_sources (id, org_id, name, type, content, url, table_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, req.orgId!, body.name, body.type, body.content ?? null, body.url ?? null, body.table_id ?? null, body.metadata ?? {}],
  );
  res.status(201).json({ id });
});

// ─── Table Records (for Tables product) ─────────────────────────────────────

authed.get("/table-assets/:id/records", async (req, res) => {
  const { view_id, search, limit: lim, offset } = req.query as Record<string, string>;
  let sql = `SELECT * FROM public.table_records WHERE table_asset_id = $1 AND org_id = $2`;
  const params: any[] = [req.params.id, req.orgId!];
  let idx = 3;
  if (search) { sql += ` AND data::text ILIKE $${idx++}`; params.push(`%${search}%`); }
  sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`;
  params.push(Number(lim) || 100, Number(offset) || 0);
  const rows = await query<any>(sql, params);
  const total = await queryOne<{ count: string }>(
    `SELECT count(*)::int as count FROM public.table_records WHERE table_asset_id = $1 AND org_id = $2`,
    [req.params.id, req.orgId!],
  );
  res.json({ records: rows, total: Number(total?.count ?? 0) });
});

authed.post("/table-assets/:id/records", async (req, res) => {
  const body = z.object({ data: z.record(z.unknown()) }).parse(req.body);
  const recordId = crypto.randomUUID();
  await query(
    `INSERT INTO public.table_records (id, table_asset_id, org_id, data, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [recordId, req.params.id, req.orgId!, body.data, req.user?.userId ?? null],
  );
  res.status(201).json({ id: recordId, data: body.data });
});

authed.patch("/table-records/:id", async (req, res) => {
  const body = z.object({ data: z.record(z.unknown()) }).parse(req.body);
  await query(
    `UPDATE public.table_records SET data = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [body.data, req.params.id, req.orgId!],
  );
  res.json({ ok: true });
});

authed.delete("/table-records/:id", async (req, res) => {
  await query(`DELETE FROM public.table_records WHERE id = $1 AND org_id = $2`, [req.params.id, req.orgId!]);
  res.json({ ok: true });
});

// ─── Table Fields ───────────────────────────────────────────────────────────

authed.get("/table-assets/:id/fields", async (req, res) => {
  const rows = await query(`SELECT * FROM public.table_fields WHERE table_asset_id = $1 ORDER BY position`, [req.params.id]);
  res.json({ fields: rows });
});

authed.post("/table-assets/:id/fields", async (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    type: z.string().default("text"),
    config: z.record(z.unknown()).optional(),
    options: z.array(z.unknown()).optional(),
    formula: z.string().optional(),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    default_value: z.unknown().optional(),
  }).parse(req.body);
  const maxPos = await queryOne<{ max_pos: number }>(
    `SELECT COALESCE(MAX(position), -1) + 1 as max_pos FROM public.table_fields WHERE table_asset_id = $1`,
    [req.params.id],
  );
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO public.table_fields (id, table_asset_id, org_id, name, type, config, options, formula, required, is_unique, default_value, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, req.params.id, req.orgId!, body.name, body.type, body.config ?? {}, body.options ?? [], body.formula ?? null, body.required ?? false, body.unique ?? false, body.default_value ?? null, maxPos?.max_pos ?? 0],
  );
  res.status(201).json({ id });
});

// ─── Table Views ────────────────────────────────────────────────────────────

authed.get("/table-assets/:id/views", async (req, res) => {
  const rows = await query(`SELECT * FROM public.table_views WHERE table_asset_id = $1 ORDER BY is_default DESC, name`, [req.params.id]);
  res.json({ views: rows });
});

authed.post("/table-assets/:id/views", async (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    type: z.string().default("grid"),
    filters: z.array(z.unknown()).optional(),
    sorts: z.array(z.unknown()).optional(),
    hidden_fields: z.array(z.string()).optional(),
    group_by: z.string().optional(),
  }).parse(req.body);
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO public.table_views (id, table_asset_id, org_id, name, type, filters, sorts, hidden_fields, group_by, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, req.params.id, req.orgId!, body.name, body.type, body.filters ?? [], body.sorts ?? [], body.hidden_fields ?? [], body.group_by ?? null, req.user?.userId ?? null],
  );
  res.status(201).json({ id });
});

router.use("/", authed);

// Connection auth loader (placeholder — real implementation uses crypto envelope)
async function loadConnectionAuth(connectionId: string, orgId: string): Promise<Record<string, unknown> | null> {
  const row = await queryOne<{ encrypted_payload: any }>(
    `SELECT encrypted_payload FROM connections WHERE id = $1 AND org_id = $2`,
    [connectionId, orgId],
  );
  if (!row?.encrypted_payload) return null;
  return typeof row.encrypted_payload === "object" ? row.encrypted_payload : {};
}
