import { Router } from "express";
import { z } from "zod";
import { APP_CATALOG } from "../catalog/catalog";
import { randomToken, hashToken } from "../crypto";
import { loadConnectionAuth } from "../connections";
import { query, queryOne } from "../db";
import { fireParserEmail } from "../events";
import { recordUsage, taskUnitsForStep } from "../metering";
import { runAdapter } from "../adapters";
import { writeAudit } from "./audit";

export const productsRouter = Router();

function slugify(name: string) {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${randomToken(4)}`;
}

async function orgId(req: { organizationId?: string }) {
  return req.organizationId!;
}


productsRouter.get("/ai/settings", async (req, res) => {
  const row = await queryOne(`select * from workspace_ai_settings where workspace_id=$1`, [req.workspaceId]);
  res.json({
    settings: row ?? {
      workspace_id: req.workspaceId,
      ai_enabled: true,
      agents_enabled: true,
      chatbots_enabled: true,
      pii_filter: true,
      monthly_activity_cap: 400
    }
  });
});

productsRouter.put("/ai/settings", async (req, res) => {
  const body = z
    .object({
      aiEnabled: z.boolean().optional(),
      agentsEnabled: z.boolean().optional(),
      chatbotsEnabled: z.boolean().optional(),
      piiFilter: z.boolean().optional(),
      monthlyActivityCap: z.number().int().min(0).optional()
    })
    .parse(req.body);
  const current = await queryOne<Record<string, unknown>>(
    `select * from workspace_ai_settings where workspace_id=$1`,
    [req.workspaceId]
  );
  const row = await queryOne(
    `insert into workspace_ai_settings (workspace_id, ai_enabled, agents_enabled, chatbots_enabled, pii_filter, monthly_activity_cap)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (workspace_id) do update set
       ai_enabled=excluded.ai_enabled,
       agents_enabled=excluded.agents_enabled,
       chatbots_enabled=excluded.chatbots_enabled,
       pii_filter=excluded.pii_filter,
       monthly_activity_cap=excluded.monthly_activity_cap,
       updated_at=now()
     returning *`,
    [
      req.workspaceId,
      body.aiEnabled ?? current?.ai_enabled ?? true,
      body.agentsEnabled ?? current?.agents_enabled ?? true,
      body.chatbotsEnabled ?? current?.chatbots_enabled ?? true,
      body.piiFilter ?? current?.pii_filter ?? true,
      body.monthlyActivityCap ?? current?.monthly_activity_cap ?? 400
    ]
  );
  res.json({ settings: row });
});

productsRouter.get("/storage", async (req, res) => {
  res.json({ items: await query(`select key, value, updated_at from workspace_kv where workspace_id=$1 order by key`, [req.workspaceId]) });
});

/* ---------- Transfers ---------- */
productsRouter.get("/transfers", async (req, res) => {
  res.json({
    transfers: await query(`select * from transfer_jobs where workspace_id=$1 order by created_at desc`, [req.workspaceId])
  });
});
productsRouter.post("/transfers", async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      source: z.record(z.unknown()),
      destination: z.record(z.unknown()),
      mapping: z.record(z.unknown()).optional()
    })
    .parse(req.body);
  const row = await queryOne(
    `insert into transfer_jobs (workspace_id, organization_id, name, source, destination, mapping)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [
      req.workspaceId,
      req.organizationId,
      body.name,
      JSON.stringify(body.source),
      JSON.stringify(body.destination),
      JSON.stringify(body.mapping ?? {})
    ]
  );
  res.json({ transfer: row });
});
productsRouter.post("/transfers/:id/run", async (req, res) => {
  const job = await queryOne<{
    id: string;
    source: { tableId?: string };
    destination: { tableId?: string };
    mapping: Record<string, string>;
  }>(`select * from transfer_jobs where id=$1 and workspace_id=$2`, [req.params.id, req.workspaceId]);
  if (!job) return res.status(404).json({ error: "not_found" });
  const srcId = job.source.tableId;
  const destId = job.destination.tableId;
  if (!srcId || !destId) return res.status(400).json({ error: "table_ids_required" });
  const rows = await query<{ data: Record<string, unknown> }>(`select data from table_records where table_id=$1`, [srcId]);
  let copied = 0;
  for (const row of rows) {
    const mapped: Record<string, unknown> = {};
    const mapping = job.mapping ?? {};
    if (Object.keys(mapping).length === 0) Object.assign(mapped, row.data);
    else {
      for (const [from, to] of Object.entries(mapping)) mapped[to] = row.data[from];
    }
    await query(`insert into table_records (table_id, data) values ($1,$2)`, [destId, JSON.stringify(mapped)]);
    copied++;
  }
  await query(`update transfer_jobs set status='succeeded', last_run_at=now() where id=$1`, [job.id]);
  res.json({ ok: true, copied });
});

/* ---------- Email parsers ---------- */
productsRouter.get("/email-parsers", async (req, res) => {
  res.json({
    parsers: await query(`select * from email_parsers where workspace_id=$1 order by created_at desc`, [req.workspaceId])
  });
});
productsRouter.post("/email-parsers", async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      template: z.object({ fields: z.array(z.object({ key: z.string(), pattern: z.string().optional() })).optional() }).optional()
    })
    .parse(req.body);
  const mailbox = `parser-${randomToken(8)}@inbound.algoverge.local`;
  const row = await queryOne(
    `insert into email_parsers (workspace_id, organization_id, name, mailbox, template) values ($1,$2,$3,$4,$5) returning *`,
    [req.workspaceId, req.organizationId, body.name, mailbox, JSON.stringify(body.template ?? { fields: [] })]
  );
  res.json({ parser: row });
});
productsRouter.post("/email-parsers/:id/ingest", async (req, res) => {
  const body = z.object({ subject: z.string(), text: z.string(), from: z.string().optional() }).parse(req.body);
  const parser = await queryOne<{ mailbox: string }>(
    `select mailbox from email_parsers where id=$1 and workspace_id=$2`,
    [req.params.id, req.workspaceId]
  );
  if (!parser) return res.status(404).json({ error: "not_found" });
  const extracted = await fireParserEmail({
    mailbox: parser.mailbox,
    subject: body.subject,
    body: body.text,
    from: body.from
  });
  res.json({ extracted });
});

/* ---------- SDK (code-level catalog + run action) ---------- */
productsRouter.get("/sdk/apps", (_req, res) => {
  res.json({
    apps: APP_CATALOG.map((a) => ({
      slug: a.slug,
      name: a.name,
      category: a.category,
      authType: a.authType,
      operations: a.operations.map((o) => ({
        key: o.key,
        name: o.name,
        type: o.type,
        inputFields: o.inputFields ?? []
      }))
    }))
  });
});

productsRouter.post("/sdk/run", async (req, res) => {
  const body = z
    .object({
      appSlug: z.string(),
      operation: z.string(),
      connectionId: z.string().uuid().optional(),
      input: z.record(z.unknown()).optional()
    })
    .parse(req.body);
  let auth: Record<string, unknown> | null = null;
  if (body.connectionId) {
    auth = await loadConnectionAuth(body.connectionId, req.workspaceId);
  }
  const result = await runAdapter({
    appSlug: body.appSlug,
    operation: body.operation,
    input: body.input ?? {},
    auth,
    workspaceId: req.workspaceId!,
    executionId: "sdk",
    connectionId: body.connectionId
  });
  const units = taskUnitsForStep({
    appSlug: body.appSlug,
    isTrigger: false,
    byok: Boolean(auth?.api_key),
    mcp: false
  });
  await recordUsage({
    organizationId: req.organizationId!,
    workspaceId: req.workspaceId!,
    metric: "tasks",
    quantity: units,
    metadata: { source: "sdk", appSlug: body.appSlug, operation: body.operation }
  });
  await writeAudit({
    organizationId: req.organizationId,
    workspaceId: req.workspaceId,
    actorId: req.user!.userId,
    action: "sdk.run",
    targetType: "app",
    targetId: body.appSlug
  });
  res.json({ output: result.output, billed: units });
});

/* ---------- Developer private apps ---------- */
productsRouter.get("/developer-apps", async (req, res) => {
  res.json({
    apps: await query(
      `select id, name, slug, client_id, visibility, status, manifest, created_at from developer_apps
       where organization_id=$1 order by created_at desc`,
      [req.organizationId]
    )
  });
});
productsRouter.post("/developer-apps", async (req, res) => {
  const body = z.object({ name: z.string().min(1), manifest: z.unknown().optional() }).parse(req.body);
  const slug = slugify(body.name);
  const clientId = `av_${randomToken(12)}`;
  const secret = randomToken(24);
  const row = await queryOne(
    `insert into developer_apps (organization_id, name, slug, client_id, client_secret_hash, manifest)
     values ($1,$2,$3,$4,$5,$6) returning id, name, slug, client_id, status, visibility`,
    [req.organizationId, body.name, slug, clientId, hashToken(secret), JSON.stringify(body.manifest ?? { version: "1.0.0", triggers: {}, creates: {} })]
  );
  res.json({ app: row, clientSecret: secret, hint: "Copy the client secret now." });
});
