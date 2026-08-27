import { Router } from "express";
import { z } from "zod";
import { normalizeWorkflowGraph } from "@algoverge/shared";
import { APP_CATALOG } from "../catalog";
import { randomToken } from "../crypto";
import { loadConnectionAuth } from "../connections";
import { query, queryOne } from "../db";
import { createExecution } from "../engine";
import { fireParserEmail, fireTableRecordEvent } from "../events";
import { recordUsage, taskUnitsForStep } from "../metering";
import { runAdapter } from "../adapters";
import { runAgentLoop, parseTools, decideAgentApproval } from "../agent-runtime";
import { completeAi } from "../ai-runtime";
import { writeAudit } from "./audit";

export const productsRouter = Router();

function slugify(name: string) {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${randomToken(4)}`;
}

async function orgId(req: { organizationId?: string }) {
  return req.organizationId!;
}

/* ---------- Agents ---------- */
productsRouter.get("/agents", async (req, res) => {
  res.json({
    agents: await query(
      `select * from agents where workspace_id=$1 order by created_at desc`,
      [req.workspaceId]
    )
  });
});

productsRouter.post("/agents", async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      instructions: z.string().optional(),
      knowledge: z.string().optional(),
      model: z.string().optional(),
      pod: z.string().optional(),
      automationId: z.string().uuid().optional(),
      tools: z.unknown().optional(),
      triggerMode: z.enum(["manual", "monitor", "event"]).optional(),
      approvalRequired: z.boolean().optional()
    })
    .passthrough()
    .parse(req.body);
  const extra = body as Record<string, unknown>;
  const instructions = String(body.instructions ?? extra.instructions ?? "");
  const tools = parseTools(body.tools);
  const row = await queryOne(
    `insert into agents (organization_id, workspace_id, name, instructions, knowledge, model, pod, automation_id, tools, trigger_mode, approval_required)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [
      await orgId(req),
      req.workspaceId,
      body.name,
      instructions,
      body.knowledge ?? "",
      body.model ?? "openai:gpt-4o-mini",
      body.pod ?? null,
      body.automationId ?? null,
      JSON.stringify(tools),
      body.triggerMode ?? "manual",
      body.approvalRequired ?? false
    ]
  );
  res.json({ agent: row });
});

productsRouter.patch("/agents/:id", async (req, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      instructions: z.string().optional(),
      knowledge: z.string().optional(),
      status: z.enum(["on", "off"]).optional(),
      pod: z.string().nullable().optional(),
      automationId: z.string().uuid().nullable().optional(),
      tools: z.unknown().optional(),
      triggerMode: z.enum(["manual", "monitor", "event"]).optional(),
      approvalRequired: z.boolean().optional()
    })
    .passthrough()
    .parse(req.body);
  const current = await queryOne<Record<string, unknown>>(
    `select * from agents where id=$1 and workspace_id=$2`,
    [req.params.id, req.workspaceId]
  );
  if (!current) return res.status(404).json({ error: "not_found" });
  const extra = body as Record<string, unknown>;
  const row = await queryOne(
    `update agents set name=$1, instructions=$2, knowledge=$3, status=$4, pod=$5, automation_id=$6,
       tools=$7, trigger_mode=$8, approval_required=$9, updated_at=now()
     where id=$10 returning *`,
    [
      body.name ?? current.name,
      body.instructions ?? extra.instructions ?? current.instructions,
      body.knowledge ?? current.knowledge,
      body.status ?? current.status,
      body.pod === undefined ? current.pod : body.pod,
      body.automationId === undefined ? current.automation_id : body.automationId,
      JSON.stringify(body.tools !== undefined ? parseTools(body.tools) : current.tools),
      body.triggerMode ?? current.trigger_mode ?? "manual",
      body.approvalRequired ?? current.approval_required ?? false,
      req.params.id
    ]
  );
  res.json({ agent: row });
});

productsRouter.get("/agents/:id/activities", async (req, res) => {
  res.json({
    activities: await query(
      `select * from agent_activities where agent_id=$1 and workspace_id=$2 order by created_at desc limit 100`,
      [req.params.id, req.workspaceId]
    )
  });
});

productsRouter.post("/agents/:id/run", async (req, res) => {
  const body = z.object({ message: z.string().min(1) }).parse(req.body);
  const agent = await queryOne<{
    id: string;
    status: string;
    instructions: string;
    knowledge: string;
    tools: unknown;
    approval_required: boolean;
    max_actions: number;
    automation_id: string | null;
  }>(`select * from agents where id=$1 and workspace_id=$2`, [req.params.id, req.workspaceId]);
  if (!agent) return res.status(404).json({ error: "not_found" });
  try {
    const result = await runAgentLoop({
      agent: {
        id: agent.id,
        instructions: agent.instructions,
        knowledge: agent.knowledge,
        tools: agent.tools,
        approval_required: agent.approval_required,
        max_actions: agent.max_actions,
        status: agent.status
      },
      message: body.message,
      workspaceId: req.workspaceId!,
      organizationId: req.organizationId!
    });
    let executionId: string | null = null;
    if (agent.automation_id && !String(result.reply).startsWith("Paused")) {
      const exec = await createExecution({
        automationId: agent.automation_id,
        triggerType: "agent",
        triggerData: { message: body.message, agentId: agent.id, reply: result.reply, traces: result.traces }
      });
      executionId = (exec as { id: string }).id;
    }
    res.json({ reply: result.reply, traces: result.traces, activity: result.activity, executionId });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "agent_failed" });
  }
});

productsRouter.get("/agent-approvals", async (req, res) => {
  res.json({
    approvals: await query(
      `select * from agent_approvals where workspace_id=$1 and status='pending' order by created_at desc`,
      [req.workspaceId]
    )
  });
});

productsRouter.post("/agent-approvals/:id/decide", async (req, res) => {
  const body = z.object({ decision: z.enum(["approved", "rejected"]) }).parse(req.body);
  const result = await decideAgentApproval({
    approvalId: req.params.id,
    workspaceId: req.workspaceId!,
    organizationId: req.organizationId!,
    userId: req.user!.userId,
    decision: body.decision
  });
  if (!result) return res.status(404).json({ error: "not_found" });
  res.json(result);
});

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

/* ---------- Chatbots ---------- */
productsRouter.get("/chatbots", async (req, res) => {
  res.json({
    chatbots: await query(`select * from chatbots where workspace_id=$1 order by created_at desc`, [req.workspaceId])
  });
});

productsRouter.post("/chatbots", async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      instructions: z.string().optional(),
      knowledge: z.string().optional(),
      automationId: z.string().uuid().optional(),
      keyword: z.string().optional()
    })
    .parse(req.body);
  const row = await queryOne(
    `insert into chatbots (organization_id, workspace_id, name, slug, instructions, knowledge, automation_id, keyword)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [
      req.organizationId,
      req.workspaceId,
      body.name,
      slugify(body.name),
      body.instructions ?? "",
      body.knowledge ?? "",
      body.automationId ?? null,
      body.keyword ?? null
    ]
  );
  res.json({ chatbot: row });
});

productsRouter.patch("/chatbots/:id", async (req, res) => {
  const body = z
    .object({
      name: z.string().optional(),
      instructions: z.string().optional(),
      knowledge: z.string().optional(),
      automationId: z.string().uuid().nullable().optional(),
      keyword: z.string().nullable().optional(),
      isPublic: z.boolean().optional()
    })
    .parse(req.body);
  const current = await queryOne<Record<string, unknown>>(
    `select * from chatbots where id=$1 and workspace_id=$2`,
    [req.params.id, req.workspaceId]
  );
  if (!current) return res.status(404).json({ error: "not_found" });
  const row = await queryOne(
    `update chatbots set name=$1, instructions=$2, knowledge=$3, automation_id=$4, keyword=$5, is_public=$6
     where id=$7 returning *`,
    [
      body.name ?? current.name,
      body.instructions ?? current.instructions,
      body.knowledge ?? current.knowledge,
      body.automationId === undefined ? current.automation_id : body.automationId,
      body.keyword === undefined ? current.keyword : body.keyword,
      body.isPublic ?? current.is_public,
      req.params.id
    ]
  );
  res.json({ chatbot: row });
});

productsRouter.post("/chatbots/:id/chat", async (req, res) => {
  const body = z.object({ message: z.string().min(1) }).parse(req.body);
  const bot = await queryOne<{
    id: string;
    instructions: string;
    knowledge: string;
    automation_id: string | null;
    keyword: string | null;
  }>(`select * from chatbots where id=$1 and workspace_id=$2`, [req.params.id, req.workspaceId]);
  if (!bot) return res.status(404).json({ error: "not_found" });
  await query(`insert into chatbot_messages (chatbot_id, role, content) values ($1,'user',$2)`, [bot.id, body.message]);
  const reply = await simpleAiReply({
    instructions: bot.instructions,
    knowledge: bot.knowledge,
    message: body.message
  });
  let executionId: string | null = null;
  const keywordHit = bot.keyword && body.message.toLowerCase().includes(bot.keyword.toLowerCase());
  if (bot.automation_id && (keywordHit || /start|run|zap|automate/i.test(body.message))) {
    const exec = await createExecution({
      automationId: bot.automation_id,
      triggerType: "chatbot",
      triggerData: { message: body.message, chatbotId: bot.id }
    });
    executionId = (exec as { id: string }).id;
  }
  await query(`insert into chatbot_messages (chatbot_id, role, content, metadata) values ($1,'assistant',$2,$3)`, [
    bot.id,
    reply,
    JSON.stringify({ executionId })
  ]);
  res.json({ reply, executionId });
});

/* ---------- Canvas ---------- */
productsRouter.get("/canvases", async (req, res) => {
  const rows = await query(`select * from canvases where workspace_id=$1 order by updated_at desc`, [req.workspaceId]);
  res.json({
    canvases: rows.map((r) => {
      const row = r as { graph?: unknown };
      return { ...row, graph: parseCanvasGraph(row.graph) };
    })
  });
});

productsRouter.post("/canvases", async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      graph: z.unknown().optional()
    })
    .passthrough()
    .parse(req.body);
  const extra = body as Record<string, unknown>;
  const sourceId = [extra.sourceAutomationId, extra.sourceAutomationId, extra.fromZap].find(
    (v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)
  );
  let graph = parseCanvasGraph(body.graph) ?? { nodes: [], edges: [] };
  if (sourceId) {
    const version = await queryOne<{ graph: unknown; name?: string }>(
      `select v.graph, a.name from automations a
       join automation_versions v on v.id = coalesce(a.current_version_id, a.published_version_id)
       where a.id=$1 and a.workspace_id=$2`,
      [sourceId, req.workspaceId]
    );
    if (version?.graph) graph = canvasFromWorkflow(version.graph);
  }
  if (!graph.nodes?.length) {
    graph = canvasFromWorkflow({
      nodes: [
        { id: "trigger", type: "trigger", label: "Trigger", position: { x: 80, y: 40 } },
        { id: "action", type: "action", label: "Action", position: { x: 80, y: 200 } }
      ],
      edges: [{ id: "e1", source: "trigger", target: "action" }]
    });
  }
  const row = await queryOne(
    `insert into canvases (organization_id, workspace_id, name, graph, source_automation_id) values ($1,$2,$3,$4,$5) returning *`,
    [req.organizationId, req.workspaceId, body.name, JSON.stringify(graph), sourceId ?? null]
  );
  res.json({ canvas: row });
});

productsRouter.patch("/canvases/:id", async (req, res) => {
  const body = z.object({ name: z.string().optional(), graph: z.unknown().optional() }).parse(req.body);
  const row = await queryOne(
    `update canvases set name=coalesce($1,name), graph=coalesce($2,graph), updated_at=now()
     where id=$3 and workspace_id=$4 returning *`,
    [body.name ?? null, body.graph ? JSON.stringify(body.graph) : null, req.params.id, req.workspaceId]
  );
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json({ canvas: row });
});

/* ---------- Interfaces ---------- */
productsRouter.get("/interfaces", async (req, res) => {
  res.json({
    interfaces: await query(`select * from interfaces where workspace_id=$1 order by created_at desc`, [req.workspaceId])
  });
});

productsRouter.post("/interfaces", async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1),
      pages: z.unknown().optional(),
      isPublic: z.boolean().optional(),
      theme: z.unknown().optional()
    })
    .parse(req.body);
  const row = await queryOne(
    `insert into interfaces (organization_id, workspace_id, name, slug, pages, is_public, theme)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [
      req.organizationId,
      req.workspaceId,
      body.name,
      slugify(body.name),
      JSON.stringify(body.pages ?? [{ type: "heading", text: body.name }, { type: "form", formId: null }]),
      body.isPublic ?? true,
      JSON.stringify(body.theme ?? {})
    ]
  );
  res.json({ interface: row });
});

productsRouter.patch("/interfaces/:id", async (req, res) => {
  const body = z
    .object({ name: z.string().optional(), pages: z.unknown().optional(), isPublic: z.boolean().optional() })
    .parse(req.body);
  const row = await queryOne(
    `update interfaces set name=coalesce($1,name), pages=coalesce($2,pages), is_public=coalesce($3,is_public), updated_at=now()
     where id=$4 and workspace_id=$5 returning *`,
    [body.name ?? null, body.pages ? JSON.stringify(body.pages) : null, body.isPublic ?? null, req.params.id, req.workspaceId]
  );
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json({ interface: row });
});

/* ---------- Variables / Storage ---------- */
productsRouter.get("/variables", async (req, res) => {
  res.json({ variables: await query(`select * from workspace_variables where workspace_id=$1 order by key`, [req.workspaceId]) });
});
productsRouter.put("/variables", async (req, res) => {
  const body = z.object({ key: z.string().min(1), value: z.string() }).parse(req.body);
  const row = await queryOne(
    `insert into workspace_variables (workspace_id, key, value) values ($1,$2,$3)
     on conflict (workspace_id, key) do update set value=excluded.value returning *`,
    [req.workspaceId, body.key, body.value]
  );
  res.json({ variable: row });
});
productsRouter.delete("/variables/:id", async (req, res) => {
  await query(`delete from workspace_variables where id=$1 and workspace_id=$2`, [req.params.id, req.workspaceId]);
  res.json({ ok: true });
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
    [req.organizationId, body.name, slug, clientId, secret, JSON.stringify(body.manifest ?? { version: "1.0.0", triggers: {}, creates: {} })]
  );
  res.json({ app: row, clientSecret: secret, hint: "Copy the client secret now." });
});

export async function patchForm(workspaceId: string, formId: string, bodyRaw: unknown) {
  const body = z
    .object({
      name: z.string().optional(),
      fields: z.unknown().optional(),
      automationId: z.string().uuid().nullable().optional(),
      tableId: z.string().uuid().nullable().optional(),
      branding: z.unknown().optional(),
      isPublic: z.boolean().optional()
    })
    .parse(bodyRaw);
  const current = await queryOne<Record<string, unknown>>(
    `select * from forms where id=$1 and workspace_id=$2`,
    [formId, workspaceId]
  );
  if (!current) return null;
  return queryOne(
    `update forms set name=$1, fields=$2, automation_id=$3, table_id=$4, branding=$5, is_public=$6
     where id=$7 returning *`,
    [
      body.name ?? current.name,
      body.fields ? JSON.stringify(body.fields) : current.fields,
      body.automationId === undefined ? current.automation_id : body.automationId,
      body.tableId === undefined ? current.table_id : body.tableId,
      body.branding ? JSON.stringify(body.branding) : current.branding,
      body.isPublic ?? current.is_public,
      formId
    ]
  );
}

function parseCanvasGraph(raw: unknown): { nodes: unknown[]; edges: unknown[] } {
  let g: unknown = raw;
  if (typeof g === "string") {
    try {
      g = JSON.parse(g);
    } catch {
      return { nodes: [], edges: [] };
    }
  }
  if (!g || typeof g !== "object") return { nodes: [], edges: [] };
  const rec = g as { nodes?: unknown; edges?: unknown };
  return {
    nodes: Array.isArray(rec.nodes) ? rec.nodes : [],
    edges: Array.isArray(rec.edges) ? rec.edges : []
  };
}

function canvasFromWorkflow(graph: unknown) {
  const g = normalizeWorkflowGraph(graph);
  return {
    nodes: g.nodes.map((n, i) => ({
      id: n.id,
      label: n.label || n.operation || (n.type === "trigger" ? "Trigger" : "Action"),
      kind: n.type,
      appSlug: n.appSlug,
      operation: n.operation,
      x: n.position.x || 80,
      y: n.position.y || 80 + i * 140
    })),
    edges: g.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle
    }))
  };
}

async function simpleAiReply(opts: { instructions: string; knowledge: string; message: string }) {
  const system = `${opts.instructions}\n\nKnowledge:\n${opts.knowledge}`.trim();
  const generated = await completeAi({
    intent: "complete",
    system: system || "You are a workspace assistant.",
    prompt: opts.message
  });
  if (generated.text) return generated.text;
  if (opts.knowledge && opts.message) {
    const hit = opts.knowledge
      .split("\n")
      .find((line) => line && opts.message.toLowerCase().includes(line.slice(0, 12).toLowerCase()));
    if (hit) return hit;
  }
  return `Noted: "${opts.message}". ${opts.instructions ? "Following your instructions, I logged this activity." : "No model key is configured (OPENAI_API_KEY); this is a deterministic reply."}`;
}
