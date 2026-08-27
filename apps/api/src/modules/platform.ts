import { Router } from "express";
import { z } from "zod";
import { env } from "../config";
import { hashToken, randomToken } from "../crypto";
import { query, queryOne } from "../db";
import { writeAudit } from "./audit";

export const platformRouter = Router();

platformRouter.get("/organization", async (req, res) => {
  const org = await queryOne(
    `select o.*, p.name as plan_name, p.monthly_price_cents, p.automation_limit, p.task_limit, p.member_limit, p.connection_limit, p.features
     from organizations o join plans p on p.slug=o.plan_slug where o.id=$1`,
    [req.organizationId]
  );
  const members = await query(
    `select u.id, u.email, u.full_name, om.role from organization_members om join users u on u.id=om.user_id
     where om.organization_id=$1 order by om.created_at`,
    [req.organizationId]
  );
  res.json({ organization: org, members });
});

platformRouter.patch("/organization", async (req, res) => {
  const body = z.object({ name: z.string().min(1) }).parse(req.body);
  const row = await queryOne(`update organizations set name=$1 where id=$2 returning id, name, slug, plan_slug`, [
    body.name,
    req.organizationId
  ]);
  await writeAudit({
    organizationId: req.organizationId,
    workspaceId: req.workspaceId,
    actorId: req.user!.userId,
    action: "org.update",
    targetType: "organization",
    targetId: req.organizationId
  });
  res.json({ organization: row });
});

platformRouter.post("/organization/members", async (req, res) => {
  const body = z.object({ email: z.string().email(), role: z.enum(["owner", "admin", "member"]).default("member") }).parse(req.body);
  const user = await queryOne<{ id: string }>(`select id from users where email=$1`, [body.email.toLowerCase()]);
  if (!user) return res.status(404).json({ error: "user_not_found", hint: "They must register first" });
  await query(
    `insert into organization_members (organization_id, user_id, role) values ($1,$2,$3)
     on conflict (organization_id, user_id) do update set role=excluded.role`,
    [req.organizationId, user.id, body.role]
  );
  res.json({ ok: true });
});

platformRouter.get("/workspaces", async (req, res) => {
  const rows = await query(
    `select w.*, wm.role from workspaces w
     join workspace_members wm on wm.workspace_id=w.id
     where w.organization_id=$1 and wm.user_id=$2 and w.deleted_at is null`,
    [req.organizationId, req.user!.userId]
  );
  res.json({ workspaces: rows });
});

platformRouter.post("/workspaces", async (req, res) => {
  const body = z.object({ name: z.string().min(1), slug: z.string().min(1).optional() }).parse(req.body);
  const slug = (body.slug ?? body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const ws = await queryOne(
    `insert into workspaces (organization_id, name, slug) values ($1,$2,$3) returning *`,
    [req.organizationId, body.name, slug]
  );
  await query(`insert into workspace_members (workspace_id, user_id, role) values ($1,$2,'owner')`, [ws!.id, req.user!.userId]);
  res.json({ workspace: ws });
});

platformRouter.patch("/workspaces/:id", async (req, res) => {
  const body = z.object({ name: z.string().min(1).optional(), timezone: z.string().optional() }).parse(req.body);
  const row = await queryOne(
    `update workspaces set name=coalesce($1,name), timezone=coalesce($2,timezone)
     where id=$3 and organization_id=$4 returning *`,
    [body.name ?? null, body.timezone ?? null, req.params.id, req.organizationId]
  );
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json({ workspace: row });
});

platformRouter.post("/workspaces/:id/members", async (req, res) => {
  const body = z.object({ email: z.string().email(), role: z.enum(["owner", "admin", "editor", "viewer"]).default("editor") }).parse(req.body);
  const member = await queryOne(`select 1 from workspaces where id=$1 and organization_id=$2`, [req.params.id, req.organizationId]);
  if (!member) return res.status(404).json({ error: "not_found" });
  const user = await queryOne<{ id: string }>(`select id from users where email=$1`, [body.email.toLowerCase()]);
  if (!user) return res.status(404).json({ error: "user_not_found" });
  await query(
    `insert into workspace_members (workspace_id, user_id, role) values ($1,$2,$3)
     on conflict (workspace_id, user_id) do update set role=excluded.role`,
    [req.params.id, user.id, body.role]
  );
  res.json({ ok: true });
});

platformRouter.get("/folders", async (req, res) => {
  res.json({
    folders: await query(`select * from automation_folders where workspace_id=$1 order by name`, [req.workspaceId])
  });
});

platformRouter.post("/folders", async (req, res) => {
  const body = z.object({ name: z.string().min(1), parentId: z.string().uuid().optional() }).parse(req.body);
  const row = await queryOne(
    `insert into automation_folders (workspace_id, name, parent_id) values ($1,$2,$3) returning *`,
    [req.workspaceId, body.name, body.parentId ?? null]
  );
  res.json({ folder: row });
});

platformRouter.patch("/automations/:id/folder", async (req, res) => {
  const body = z.object({ folderId: z.string().uuid().nullable() }).parse(req.body);
  const row = await queryOne(
    `update automations set folder_id=$1 where id=$2 and workspace_id=$3 returning id, folder_id`,
    [body.folderId, req.params.id, req.workspaceId]
  );
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json({ automation: row });
});

platformRouter.get("/automations/:id/versions", async (req, res) => {
  const auto = await queryOne(`select id from automations where id=$1 and workspace_id=$2`, [req.params.id, req.workspaceId]);
  if (!auto) return res.status(404).json({ error: "not_found" });
  const versions = await query(
    `select id, version_number, published_at, published_by, created_at from automation_versions
     where automation_id=$1 order by version_number desc`,
    [req.params.id]
  );
  res.json({ versions });
});

platformRouter.get("/automations/:id/versions/:versionId", async (req, res) => {
  const version = await queryOne(
    `select v.* from automation_versions v
     join automations a on a.id=v.automation_id
     where v.id=$1 and a.id=$2 and a.workspace_id=$3`,
    [req.params.versionId, req.params.id, req.workspaceId]
  );
  if (!version) return res.status(404).json({ error: "not_found" });
  res.json({ version });
});

platformRouter.get("/automations/:id/diff", async (req, res) => {
  const fromId = String(req.query.from ?? "");
  const toId = String(req.query.to ?? "");
  if (!fromId || !toId) return res.status(400).json({ error: "from_and_to_required" });
  const from = await queryOne<{ graph: unknown; version_number: number }>(
    `select v.graph, v.version_number from automation_versions v
     join automations a on a.id=v.automation_id where v.id=$1 and a.id=$2 and a.workspace_id=$3`,
    [fromId, req.params.id, req.workspaceId]
  );
  const to = await queryOne<{ graph: unknown; version_number: number }>(
    `select v.graph, v.version_number from automation_versions v
     join automations a on a.id=v.automation_id where v.id=$1 and a.id=$2 and a.workspace_id=$3`,
    [toId, req.params.id, req.workspaceId]
  );
  if (!from || !to) return res.status(404).json({ error: "not_found" });
  res.json({ from: from.version_number, to: to.version_number, fromGraph: from.graph, toGraph: to.graph });
});

platformRouter.get("/webhook-events", async (req, res) => {
  res.json({
    events: await query(
      `select id, public_id, processing_status, received_at, execution_id from webhook_events
       where workspace_id=$1 order by received_at desc limit 100`,
      [req.workspaceId]
    )
  });
});

platformRouter.get("/forms/:id/submissions", async (req, res) => {
  const form = await queryOne(`select id from forms where id=$1 and workspace_id=$2`, [req.params.id, req.workspaceId]);
  if (!form) return res.status(404).json({ error: "not_found" });
  res.json({
    submissions: await query(`select id, data, created_at from form_submissions where form_id=$1 order by created_at desc limit 200`, [
      req.params.id
    ])
  });
});

platformRouter.get("/audit", async (req, res) => {
  res.json({
    logs: await query(
      `select id, action, target_type, target_id, created_at, metadata from audit_logs
       where workspace_id=$1 order by created_at desc limit 100`,
      [req.workspaceId]
    )
  });
});

platformRouter.get("/api-keys", async (req, res) => {
  res.json({
    keys: await query(
      `select id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at from api_keys
       where workspace_id=$1 order by created_at desc`,
      [req.workspaceId]
    )
  });
});

platformRouter.post("/api-keys", async (req, res) => {
  const body = z.object({ name: z.string().min(1), scopes: z.array(z.string()).optional() }).parse(req.body);
  const secret = `avkey_${randomToken(24)}`;
  const row = await queryOne<{ id: string }>(
    `insert into api_keys (organization_id, workspace_id, user_id, name, key_prefix, key_hash, scopes)
     values ($1,$2,$3,$4,$5,$6,$7) returning id, name, key_prefix, scopes, created_at`,
    [
      req.organizationId,
      req.workspaceId,
      req.user!.userId,
      body.name,
      secret.slice(0, 12),
      hashToken(secret),
      body.scopes ?? ["*"]
    ]
  );
  await writeAudit({
    organizationId: req.organizationId,
    workspaceId: req.workspaceId,
    actorId: req.user!.userId,
    action: "api_key.create",
    targetType: "api_key",
    targetId: row!.id
  });
  res.json({ key: row, secret, hint: "Copy now. The secret is not stored in plaintext." });
});

platformRouter.delete("/api-keys/:id", async (req, res) => {
  await query(`update api_keys set revoked_at=now() where id=$1 and workspace_id=$2`, [req.params.id, req.workspaceId]);
  res.json({ ok: true });
});

platformRouter.get("/mcp/tokens", async (req, res) => {
  res.json({
    tokens: await query(
      `select id, name, token_prefix, scopes, last_used_at, revoked_at, created_at from mcp_tokens
       where workspace_id=$1 order by created_at desc`,
      [req.workspaceId]
    )
  });
});

platformRouter.post("/mcp/tokens", async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      scopes: z.array(z.string()).optional()
    })
    .parse(req.body);
  const secret = `avmcp_${randomToken(24)}`;
  const row = await queryOne<{ id: string }>(
    `insert into mcp_tokens (workspace_id, organization_id, created_by, name, token_hash, token_prefix, scopes)
     values ($1,$2,$3,$4,$5,$6,$7) returning id, name, token_prefix, scopes, created_at`,
    [
      req.workspaceId,
      req.organizationId,
      req.user!.userId,
      body.name,
      hashToken(secret),
      secret.slice(0, 12),
      body.scopes ?? ["tools:invoke"]
    ]
  );
  await writeAudit({
    organizationId: req.organizationId,
    workspaceId: req.workspaceId,
    actorId: req.user!.userId,
    action: "mcp.token.create",
    targetType: "mcp_token",
    targetId: row!.id
  });
  res.json({
    token: row,
    secret,
    endpoint: `${env.apiUrl}/mcp`,
    hint: "Use Authorization: Bearer <secret>. Shown once."
  });
});

platformRouter.delete("/mcp/tokens/:id", async (req, res) => {
  await query(`update mcp_tokens set revoked_at=now() where id=$1 and workspace_id=$2`, [req.params.id, req.workspaceId]);
  res.json({ ok: true });
});

platformRouter.get("/billing", async (req, res) => {
  const org = await queryOne<{ plan_slug: string; stripe_customer_id: string | null }>(
    `select plan_slug, stripe_customer_id from organizations where id=$1`,
    [req.organizationId]
  );
  const plans = await query(`select slug, name, monthly_price_cents, automation_limit, task_limit, member_limit, connection_limit, features from plans order by monthly_price_cents`);
  const subscription = await queryOne(`select * from subscriptions where organization_id=$1 order by created_at desc limit 1`, [
    req.organizationId
  ]);
  const usage = await query(
    `select metric, sum(quantity) as quantity from usage_records where organization_id=$1 and period_start=current_date group by metric`,
    [req.organizationId]
  );
  res.json({
    plan: org?.plan_slug,
    stripeCustomerId: org?.stripe_customer_id,
    stripeConfigured: Boolean(env.stripe.secret),
    plans,
    subscription,
    usage
  });
});

platformRouter.post("/billing/checkout", async (req, res) => {
  const body = z.object({ planSlug: z.string() }).parse(req.body);
  if (!env.stripe.secret) {
    return res.status(501).json({
      error: "stripe_not_configured",
      hint: "Create a Stripe account, add STRIPE_SECRET_KEY and STRIPE_PRICE_* to .env, then retry."
    });
  }
  const priceMap: Record<string, string | undefined> = {
    professional: process.env.STRIPE_PRICE_PROFESSIONAL,
    team: process.env.STRIPE_PRICE_TEAM,
    business: process.env.STRIPE_PRICE_BUSINESS,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE
  };
  const price = priceMap[body.planSlug];
  if (!price) {
    return res.status(400).json({ error: "missing_price_id", hint: `Set STRIPE_PRICE_${body.planSlug.toUpperCase()} in .env` });
  }
  const params = new URLSearchParams({
    mode: "subscription",
    success_url: `${env.appUrl}/app/billing?checkout=success`,
    cancel_url: `${env.appUrl}/app/billing?checkout=cancel`,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    client_reference_id: req.organizationId!,
    "metadata[organization_id]": req.organizationId!
  });
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.stripe.secret}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: params
  });
  const json = (await r.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!r.ok) return res.status(400).json({ error: json.error?.message ?? "stripe_checkout_failed" });
  await writeAudit({
    organizationId: req.organizationId,
    workspaceId: req.workspaceId,
    actorId: req.user!.userId,
    action: "billing.checkout",
    targetType: "plan",
    targetId: body.planSlug
  });
  res.json({ url: json.url, id: json.id });
});
