import type { AppManifest, AppOperation, GraphNode, WorkflowGraph } from "@algoverge/shared";
import { env } from "../config";
import { APP_CATALOG } from "../catalog/catalog";
import { query } from "../db";
import { pickForCopilot } from "../connections";
import { pieceRegistry } from "../pieces/registry";
import { copilotShouldPersist, parseCopilotMode, type CopilotMode } from "./copilot-pipeline";
import {
  classifyCopilotChapter,
  describeDraft,
  inspectDraft,
  isStarterDraft,
  orchestrateCopilot
} from "./copilot-orchestrator";
import { adviseWorkflow } from "../workflow-advisor";

const HINTS: Array<{ re: RegExp; slug: string }> = [
  { re: /gmail|inbox|email/i, slug: "gmail" },
  { re: /google sheet|spreadsheet|\bsheets\b/i, slug: "google-sheets" },
  { re: /calendar|meeting/i, slug: "google-calendar" },
  { re: /drive|file upload/i, slug: "google-drive" },
  { re: /slack/i, slug: "slack" },
  { re: /hubspot/i, slug: "hubspot" },
  { re: /salesforce/i, slug: "salesforce" },
  { re: /notion/i, slug: "notion" },
  { re: /airtable/i, slug: "airtable" },
  { re: /github|pull request|issue/i, slug: "github" },
  { re: /discord/i, slug: "discord" },
  { re: /telegram/i, slug: "telegram" },
  { re: /whatsapp/i, slug: "whatsapp" },
  { re: /stripe|payment|invoice/i, slug: "stripe" },
  { re: /twilio|sms/i, slug: "twilio" },
  { re: /jira/i, slug: "jira" },
  { re: /linear/i, slug: "linear" },
  { re: /calendly/i, slug: "calendly" },
  { re: /webhook|http post|catch hook/i, slug: "webhook" },
  { re: /schedule|every day|cron|every hour/i, slug: "schedule" },
  { re: /openai|chatgpt|summar/i, slug: "openai" },
  { re: /claude|anthropic/i, slug: "anthropic" },
  { re: /gemini/i, slug: "gemini" },
  { re: /form submit/i, slug: "forms" },
  { re: /table row|new record/i, slug: "tables" },
  { re: /shopify/i, slug: "shopify" },
  { re: /klaviyo/i, slug: "klaviyo" },
  { re: /asana/i, slug: "asana" },
  { re: /trello/i, slug: "trello" },
  { re: /zendesk/i, slug: "zendesk" },
  { re: /docusign/i, slug: "docusign" },
  { re: /\brss\b/i, slug: "rss" },
  { re: /outlook/i, slug: "outlook" }
];

type OpHint = { re: RegExp; slug: string; key: string; asTrigger?: boolean };

const OP_HINTS: OpHint[] = [
  { re: /create event/i, slug: "google-calendar", key: "create_event" },
  { re: /list events/i, slug: "google-calendar", key: "list_events" },
  { re: /update event/i, slug: "google-calendar", key: "update_event" },
  { re: /delete event/i, slug: "google-calendar", key: "delete_event" },
  { re: /new (calendar )?event/i, slug: "google-calendar", key: "new_event", asTrigger: true },
  { re: /create spreadsheet/i, slug: "google-sheets", key: "create_spreadsheet" },
  { re: /read sheet( data)?/i, slug: "google-sheets", key: "read_sheet" },
  { re: /append row/i, slug: "google-sheets", key: "append_row" },
  { re: /update row/i, slug: "google-sheets", key: "update_row" },
  { re: /create row/i, slug: "google-sheets", key: "create_row" },
  { re: /clear (spreadsheet )?row/i, slug: "google-sheets", key: "clear_row" },
  { re: /new row/i, slug: "google-sheets", key: "new_row", asTrigger: true }
];

function appBySlug(slug: string) {
  return APP_CATALOG.find((a) => a.slug === slug);
}

function pickApp(prompt: string, used: Set<string>) {
  let best: { app: AppManifest; index: number } | undefined;
  for (const h of HINTS) {
    if (used.has(h.slug)) continue;
    const m = prompt.match(h.re);
    if (m?.index == null) continue;
    const app = appBySlug(h.slug);
    if (!app) continue;
    if (!best || m.index < best.index) best = { app, index: m.index };
  }
  if (best) return best.app;
  const lower = prompt.toLowerCase();
  const ranked = [...APP_CATALOG]
    .filter((app) => !used.has(app.slug))
    .map((app) => {
      const name = app.name.toLowerCase();
      const slug = app.slug.replace(/-/g, " ");
      const idx = lower.includes(name) ? lower.indexOf(name) : lower.includes(slug) ? lower.indexOf(slug) : -1;
      return { app, index: idx, score: idx < 0 ? 0 : name.length };
    })
    .filter((row) => row.index >= 0 && row.score > 2)
    .sort((a, b) => a.index - b.index || b.score - a.score);
  return ranked[0]?.app;
}

function triggerOp(app: AppManifest) {
  return app.operations.find((o) => o.type === "trigger") ?? app.operations[0];
}

function actionOp(app: AppManifest) {
  return app.operations.find((o) => o.type !== "trigger") ?? app.operations[0];
}

function findOp(app: AppManifest, key: string): AppOperation {
  return app.operations.find((o) => o.key === key) ?? actionOp(app);
}

function collectOps(prompt: string): OpHint[] {
  const hits: Array<OpHint & { index: number }> = [];
  for (const h of OP_HINTS) {
    const m = prompt.match(h.re);
    if (m && m.index != null) hits.push({ ...h, index: m.index });
  }
  hits.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const out: OpHint[] = [];
  for (const h of hits) {
    const k = `${h.slug}:${h.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out;
}

function defaultConfig(slug: string, key: string, ids: Record<string, string>): Record<string, unknown> {
  const calCreate = ids["google-calendar:create_event"];
  const sheetCreate = ids["google-sheets:create_spreadsheet"];
  const sheetId = sheetCreate ? `{{steps.${sheetCreate}.spreadsheetId}}` : "";
  const eventId = calCreate ? `{{steps.${calCreate}.id}}` : "";
  if (slug === "google-calendar") {
    if (key === "create_event") {
      return { calendarId: "primary", summary: "Copilot test event", start: "{{trigger.start}}", end: "{{trigger.end}}" };
    }
    if (key === "list_events") return { calendarId: "primary", maxResults: "10" };
    if (key === "update_event") return { calendarId: "primary", eventId, summary: "Updated by Copilot" };
    if (key === "delete_event") return { calendarId: "primary", eventId };
    if (key === "new_event") return { calendarId: "primary" };
  }
  if (slug === "google-sheets") {
    if (key === "create_spreadsheet") return { title: "Copilot test spreadsheet", sheet: "Sheet1" };
    if (key === "read_sheet") return { spreadsheetId: sheetId, sheet: "Sheet1" };
    if (key === "append_row" || key === "create_row") {
      // Resource selection is deliberately left to the user. Values are filled
      // later from the actual upstream trigger schema, rather than assuming a
      // calendar-shaped payload for every workflow.
      return { spreadsheetId: sheetId, sheet: "", values: "" };
    }
    if (key === "update_row") return { spreadsheetId: sheetId, sheet: "Sheet1", row: "2", values: '["updated"]' };
    if (key === "find_row") return { spreadsheetId: sheetId, sheet: "Sheet1", query: "{{trigger.summary}}" };
    if (key === "new_row") return { spreadsheetId: sheetId, sheet: "Sheet1" };
  }
  if (slug === "schedule") return { cron: "0 * * * *", timezone: "UTC" };
  return {};
}

function nodeKind(appSlug: string, op: AppOperation, forceTrigger: boolean): GraphNode["type"] {
  if (forceTrigger) return "trigger";
  if (appSlug === "filter" || appSlug === "paths") return "logic";
  if (op.type === "trigger") return "action";
  return op.type === "action" || op.type === "search" ? "action" : "action";
}

function makeNode(opts: {
  id: string;
  forceTrigger?: boolean;
  app: AppManifest;
  op: AppOperation;
  y: number;
  x?: number;
  config: Record<string, unknown>;
}): GraphNode {
  return {
    id: opts.id,
    type: nodeKind(opts.app.slug, opts.op, Boolean(opts.forceTrigger)),
    appSlug: opts.app.slug,
    operation: opts.op.key,
    label: opts.op.name,
    position: { x: opts.x ?? 280, y: opts.y },
    config: opts.config,
    connectionId: null
  };
}

const PLACEHOLDER_APPS = new Set(["webhook", "http", "manual"]);

export function isGenericGraph(graph?: WorkflowGraph | null) {
  return isStarterDraft(graph);
}

export function isExplainOnlyPrompt(prompt: string) {
  const text = prompt.trim();
  if (/^(hi|hello|hey|thanks|thank you)[\s!.]*$/i.test(text)) return true;
  if (/explain the last test/i.test(text)) return true;
  if (/explain what is left|what is left before publish/i.test(text)) return true;
  return /^explain\b/i.test(text) && !/\b(fix|map|use|change|add|build|replace)\b/i.test(text);
}

export function isCatalogGraph(graph?: WorkflowGraph | null) {
  if (!graph?.nodes?.length) return false;
  const ids = new Set<string>();
  let triggerCount = 0;

  for (const node of graph.nodes) {
    if (!node.id || ids.has(node.id)) return false;
    ids.add(node.id);
    const app = appBySlug(node.appSlug);
    const operation = app?.operations.find((candidate) => candidate.key === node.operation);
    if (!app || !operation || !pieceRegistry.has(node.appSlug)) return false;
    if (containsCredentialMaterial(node.config)) return false;
    if (node.type === "trigger") {
      triggerCount += 1;
      if (operation.type !== "trigger") return false;
    } else if (operation.type === "trigger") {
      return false;
    }
  }

  if (triggerCount !== 1) return false;
  return graph.edges.every((edge) => edge.id && ids.has(edge.source) && ids.has(edge.target));
}

function containsCredentialMaterial(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCredentialMaterial);
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (/^(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|private[_-]?key|secret)$/i.test(key)) {
      return true;
    }
    if (containsCredentialMaterial(child)) return true;
  }
  return false;
}

export function mentionsWorkflowIntent(prompt: string) {
  if (OP_HINTS.some((h) => h.re.test(prompt))) return true;
  if (HINTS.some((h) => h.slug !== "webhook" && h.re.test(prompt))) return true;
  return /\b(build|generate|create)\b.+\b(zap|workflow|flow|automation)\b/i.test(prompt);
}

export function graphFromCatalogPicks(opts: {
  trigger: { slug: string; key: string };
  actions: Array<{ slug: string; key: string }>;
}): WorkflowGraph | null {
  const triggerApp = appBySlug(opts.trigger.slug);
  if (!triggerApp) return null;
  const tOp = findOp(triggerApp, opts.trigger.key);
  if (!tOp || tOp.type !== "trigger") return null;
  const ids: Record<string, string> = {};
  const nodes: GraphNode[] = [
    makeNode({
      id: "trigger",
      forceTrigger: true,
      app: triggerApp,
      op: tOp,
      y: 40,
      config: defaultConfig(triggerApp.slug, tOp.key, ids)
    })
  ];
  const edges: WorkflowGraph["edges"] = [];
  let prev = "trigger";
  opts.actions.forEach((pick, i) => {
    const app = appBySlug(pick.slug);
    if (!app) return;
    const op = findOp(app, pick.key);
    if (!op || op.type === "trigger") return;
    const id = `${app.slug.replace(/[^a-z0-9]/gi, "")}-${op.key}`.slice(0, 48) || `action-${i + 1}`;
    ids[`${app.slug}:${op.key}`] = id;
    nodes.push(makeNode({ id, app, op, y: 200 + i * 160, config: defaultConfig(app.slug, op.key, ids) }));
    edges.push({ id: `e-${prev}-${id}`, source: prev, target: id });
    prev = id;
  });
  if (nodes.length === 1) {
    const http = appBySlug("http")!;
    nodes.push(makeNode({ id: "action", app: http, op: actionOp(http), y: 200, config: {} }));
    edges.push({ id: "e-t-a", source: "trigger", target: "action" });
  }
  return { nodes, edges };
}

export function graphFromPrompt(prompt: string): WorkflowGraph {
  const ops = collectOps(prompt);
  const wantsPaths = /\b(if|else|otherwise|path|branch|router|when .+ then)\b/i.test(prompt);
  const testLike = /test .+ integration|end-to-end|\be2e\b/i.test(prompt);

  if (ops.length) {
    const triggerHint = ops.find((o) => o.asTrigger);
    const used = new Set<string>();
    let triggerApp: AppManifest;
    let tOp: AppOperation;
    if (triggerHint && !testLike) {
      triggerApp = appBySlug(triggerHint.slug)!;
      tOp = findOp(triggerApp, triggerHint.key);
      used.add(`${triggerHint.slug}:${triggerHint.key}`);
    } else if (/webhook|catch hook/i.test(prompt)) {
      triggerApp = appBySlug("webhook")!;
      tOp = triggerOp(triggerApp);
    } else if (/schedule|every day|cron|every hour/i.test(prompt)) {
      triggerApp = appBySlug("schedule")!;
      tOp = triggerOp(triggerApp);
    } else {
      // An action hint (for example "append row") must not erase an app-event
      // trigger named elsewhere in the same sentence (for example Gmail).
      const hintedTrigger = HINTS.map((hint) => appBySlug(hint.slug)).find(
        (app) => app && app.slug !== ops[0]?.slug && app.operations.some((operation) => operation.type === "trigger") && HINTS.some((hint) => hint.slug === app.slug && hint.re.test(prompt))
      );
      triggerApp = hintedTrigger ?? appBySlug("manual")!;
      tOp = triggerOp(triggerApp);
    }

    const ids: Record<string, string> = {};
    const nodes: GraphNode[] = [
      makeNode({
        id: "trigger",
        forceTrigger: true,
        app: triggerApp,
        op: tOp,
        y: 40,
        config: defaultConfig(triggerApp.slug, tOp.key, ids)
      })
    ];
    const edges: WorkflowGraph["edges"] = [];
    let prev = "trigger";
    let i = 0;
    for (const h of ops) {
      const k = `${h.slug}:${h.key}`;
      if (used.has(k)) continue;
      const app = appBySlug(h.slug);
      if (!app) continue;
      const op = findOp(app, h.key);
      const id = `${h.slug.replace(/[^a-z0-9]/gi, "")}-${h.key}`;
      ids[k] = id;
      used.add(k);
      nodes.push(
        makeNode({
          id,
          app,
          op,
          y: 200 + i * 160,
          config: defaultConfig(h.slug, h.key, ids)
        })
      );
      edges.push({ id: `e-${prev}-${id}`, source: prev, target: id });
      prev = id;
      i += 1;
    }
    if (nodes.length === 1) {
      const http = appBySlug("http")!;
      const aOp = actionOp(http);
      nodes.push(makeNode({ id: "action", app: http, op: aOp, y: 200, config: {} }));
      edges.push({ id: "e-t-a", source: "trigger", target: "action" });
    }
    return { nodes, edges };
  }

  const calendar = /calendar/i.test(prompt) ? appBySlug("google-calendar") : undefined;
  const sheets = /sheet|spreadsheet/i.test(prompt) ? appBySlug("google-sheets") : undefined;
  if (calendar && sheets) {
    const tOp = triggerOp(calendar);
    const aOp = findOp(sheets, "append_row");
    return {
      nodes: [
        makeNode({
          id: "trigger",
          forceTrigger: true,
          app: calendar,
          op: tOp,
          y: 40,
          config: defaultConfig(calendar.slug, tOp.key, {})
        }),
        makeNode({
          id: "action",
          app: sheets,
          op: aOp,
          y: 200,
          config: defaultConfig(sheets.slug, aOp.key, {})
        })
      ],
      edges: [{ id: "e-t-a", source: "trigger", target: "action" }]
    };
  }

  const usedApps = new Set<string>();
  const first = pickApp(prompt, usedApps) ?? appBySlug("webhook")!;
  usedApps.add(first.slug);
  const second = pickApp(prompt, usedApps) ?? appBySlug("http")!;
  usedApps.add(second.slug);
  const third = pickApp(prompt, usedApps);

  const tOp = triggerOp(first);
  const aOp = actionOp(second);
  const trigger = makeNode({
    id: "trigger",
    forceTrigger: true,
    app: first,
    op: tOp,
    y: 40,
    config: defaultConfig(first.slug, tOp.key, {})
  });
  const action = makeNode({
    id: "action",
    app: second,
    op: aOp,
    y: 200,
    config: defaultConfig(second.slug, aOp.key, {})
  });

  if (wantsPaths) {
    const pathsApp = appBySlug("paths")!;
    const router = findOp(pathsApp, "router");
    const pathNode = makeNode({
      id: "paths",
      app: pathsApp,
      op: router,
      y: 200,
      config: {
        paths: [
          { id: "path-a", label: "Path A", left: "{{Trigger}}", operator: "not_empty", right: "", fallback: false },
          { id: "path-b", label: "Path B", fallback: true }
        ]
      }
    });
    const left = { ...action, id: "path-a-step", position: { x: 80, y: 360 } };
    const rightApp = third ?? appBySlug("slack")!;
    const rOp = actionOp(rightApp);
    const right = makeNode({
      id: "path-b-step",
      app: rightApp,
      op: rOp,
      y: 360,
      x: 480,
      config: defaultConfig(rightApp.slug, rOp.key, {})
    });
    return {
      nodes: [trigger, pathNode, left, right],
      edges: [
        { id: "e-t-p", source: "trigger", target: "paths" },
        { id: "e-p-a", source: "paths", target: "path-a-step", sourceHandle: "path-a" },
        { id: "e-p-b", source: "paths", target: "path-b-step", sourceHandle: "path-b" }
      ]
    };
  }

  const nodes = [trigger, action];
  const edges = [{ id: "e-t-a", source: "trigger", target: "action" }];
  if (third) {
    const op = actionOp(third);
    nodes.push(
      makeNode({
        id: "action-2",
        app: third,
        op,
        y: 360,
        config: defaultConfig(third.slug, op.key, {})
      })
    );
    edges.push({ id: "e-a-2", source: "action", target: "action-2" });
  }
  return { nodes, edges };
}

function describeGraph(graph: WorkflowGraph) {
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  const actions = graph.nodes.filter((n) => n.type !== "trigger");
  const parts = [
    `Trigger: ${trigger?.label ?? "unset"} (${trigger?.appSlug || "no app"}).`,
    ...actions.map((n, i) => `Action ${i + 1}: ${n.label} (${n.appSlug}).`)
  ];
  const oauth = [...new Set(graph.nodes.filter((n) => n.appSlug.startsWith("google-") && !n.connectionId).map((n) => n.appSlug))];
  if (oauth.length) {
    parts.push(`Connect ${oauth.join(" and ")} on those steps, map any empty fields, then click Test workflow.`);
  } else if (graph.nodes.some((n) => !n.connectionId && n.appSlug && n.appSlug !== "webhook" && n.appSlug !== "http" && n.appSlug !== "manual" && n.appSlug !== "schedule")) {
    parts.push("Connect any steps that still show Connect, map empty fields, then Test and Publish. Copilot never stores credentials on the workflow.");
  } else {
    parts.push("Review field mappings, then click Test workflow.");
  }
  return parts.join(" ");
}

function defaultFieldValue(_appSlug: string, operation: AppOperation, key: string, type: string) {
  if (key === "url") return "https://httpbin.org/post";
  if (key === "method") return "POST";
  if (key === "calendarId") return "primary";
  if (key === "sheet") return "Sheet1";
  if (key === "timezone") return "UTC";
  if (key === "cron") return "0 * * * *";
  if (key === "values") return '["{{trigger}}"]';
  if (key === "body" || type === "json") return "{{trigger}}";
  if (key === "summary" || key === "subject") return "Created by Copilot";
  if (key === "text") return "{{trigger}}";
  if (key === "to" || key === "email" || key === "recipient") return "{{trigger.email}}";
  if (operation.type === "trigger") return "";
  return type === "number" ? "1" : "{{trigger}}";
}

export function repairIncompleteGraph(graph: WorkflowGraph): { graph: WorkflowGraph; changed: boolean } {
  let changed = false;
  const repaired = {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const app = appBySlug(node.appSlug);
      if (!app) return node;
      const operation = node.operation ? app.operations.find((candidate) => candidate.key === node.operation) : undefined;
      const nextOperation = operation ?? (node.type === "trigger" ? triggerOp(app) : actionOp(app));
      const config = { ...(node.config ?? {}) };
      for (const field of nextOperation.inputFields ?? []) {
        if (field.required && (config[field.key] === undefined || config[field.key] === "")) {
          config[field.key] = defaultFieldValue(app.slug, nextOperation, field.key, field.type);
          changed = true;
        }
      }
      if (!node.operation) changed = true;
      return { ...node, operation: nextOperation.key, label: node.label || nextOperation.name, config };
    })
  };
  return { graph: repaired, changed };
}

export async function bindExistingConnections(
  graph: WorkflowGraph,
  workspaceId?: string | null,
  userEmail?: string | null
) {
  if (!workspaceId) return graph;
  const nodes = [];
  for (const node of graph.nodes) {
    if (node.connectionId) {
      nodes.push(node);
      continue;
    }
    const picked = await pickForCopilot({ workspaceId, pieceName: node.appSlug, userEmail });
    nodes.push(picked.connectionId ? { ...node, connectionId: picked.connectionId } : node);
  }
  return { ...graph, nodes };
}

async function coerceCopilotGraph(raw: unknown): Promise<WorkflowGraph | null> {
  if (!raw || typeof raw !== "object") return null;
  const { safeParseFlowDefinition, flowDefinitionToGraph } = await import("@algoverge/core");
  const parsed = safeParseFlowDefinition(raw);
  if (parsed.success) return flowDefinitionToGraph(parsed.data);
  const graph = raw as WorkflowGraph;
  if (Array.isArray(graph.nodes)) return graph;
  return null;
}

function catalogForAi() {
  return {
    slugs: APP_CATALOG.map((a) => a.slug),
    operations: Object.fromEntries(APP_CATALOG.map((a) => [a.slug, a.operations.map((o) => o.key)]))
  };
}

/** Structured model output is accepted only after catalog validation. It is a
 * draft compiler input, never an execution or publishing instruction. */
export async function graphFromLanguageModel(prompt: string): Promise<{ graph: WorkflowGraph; source: string } | null> {
  const catalog = catalogForAi();
  if (env.openai) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.openai}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are Zapier-style Copilot. Return JSON {nodes,edges}. Node fields: id,type(trigger|action|logic),appSlug,operation,label,position{x,y},config,connectionId:null. Exactly one trigger. Use only these slugs and operations: " +
                JSON.stringify(catalog.operations)
            },
            { role: "user", content: prompt }
          ]
        }),
        signal: AbortSignal.timeout(20000)
      });
      if (r.ok) {
        const d = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const parsed = await coerceCopilotGraph(JSON.parse(d.choices?.[0]?.message?.content ?? "{}"));
        if (parsed?.nodes?.length && isCatalogGraph(parsed)) return { graph: parsed, source: "openai" };
      }
    } catch {
      /* fall through */
    }
  }
  return null;
}

export async function copilotGraph(
  prompt: string,
  workspaceId?: string | null,
  opts?: {
    userEmail?: string | null;
    automationId?: string;
    mode?: CopilotMode;
    graph?: WorkflowGraph | null;
    selectedStepId?: string | null;
  }
): Promise<{
  graph: WorkflowGraph;
  source: string;
  summary: string;
  rebuilt?: boolean;
  chapter?: string;
  changed?: boolean;
}> {
  if (/\b(publish|turn on|go live)\b/i.test(prompt) && !/\b(draft|build|create|fix)\b/i.test(prompt)) {
    const existing = opts?.graph && !isStarterDraft(opts.graph) ? opts.graph : graphFromPrompt(prompt);
    return {
      graph: existing,
      source: "copilot",
      summary: "Copilot can only edit drafts. Publish remains a human action.",
      rebuilt: false,
      chapter: "inspect",
      changed: false
    };
  }
  const done = async (
    graph: WorkflowGraph,
    source: string,
    summary: string,
    extra?: { rebuilt?: boolean; chapter?: string; changed?: boolean }
  ) => {
    const bound = extra?.changed === false && extra?.rebuilt === false
      ? graph
      : await bindExistingConnections(graph, workspaceId, opts?.userEmail);
    return {
      graph: bound,
      source,
      summary,
      rebuilt: extra?.rebuilt,
      chapter: extra?.chapter,
      changed: extra?.changed
    };
  };
  const trimmed = prompt.trim();
  const turn = orchestrateCopilot({
    prompt: trimmed || prompt,
    graph: opts?.graph,
    selectedStepId: opts?.selectedStepId,
    mode: opts?.mode
  });
  if (turn.chapter !== "rebuild") {
    const graph = turn.graph ?? opts?.graph;
    if (graph?.nodes?.length) {
      return done(graph, "copilot-orchestrator", turn.reply, {
        rebuilt: false,
        chapter: turn.chapter,
        changed: Boolean(turn.changed)
      });
    }
    return {
      graph: graph ?? { nodes: [], edges: [] },
      source: "copilot-orchestrator",
      summary: turn.reply,
      rebuilt: false,
      chapter: turn.chapter,
      changed: false
    };
  }
  if (!trimmed) {
    const graph = opts?.graph && !isStarterDraft(opts.graph) ? opts.graph : graphFromPrompt("webhook to http");
    return done(
      graph,
      "copilot",
      isStarterDraft(opts?.graph) ? "Empty prompt — describe the trigger and actions." : describeDraft(inspectDraft(graph)),
      { rebuilt: false, chapter: "inspect", changed: false }
    );
  }

  const fromModel = await graphFromLanguageModel(trimmed);
  if (fromModel) {
    return done(fromModel.graph, fromModel.source, describeGraph(fromModel.graph), {
      rebuilt: true,
      chapter: "rebuild",
      changed: true
    });
  }

  const local = graphFromPrompt(trimmed);
  return done(local, "copilot", describeGraph(local), { rebuilt: true, chapter: "rebuild", changed: true });
}

export function shouldBuildFromChat(prompt: string, graph?: WorkflowGraph, selectedStepId?: string | null) {
  const snapshot = inspectDraft(graph);
  return classifyCopilotChapter(prompt, snapshot, selectedStepId) === "rebuild";
}

function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return JSON.parse(JSON.stringify(graph)) as WorkflowGraph;
}

function mentionedApps(prompt: string) {
  const used = new Set<string>();
  const apps: AppManifest[] = [];
  for (const hint of HINTS) {
    if (!hint.re.test(prompt) || used.has(hint.slug)) continue;
    const app = appBySlug(hint.slug);
    if (!app) continue;
    used.add(hint.slug);
    apps.push(app);
  }
  return apps;
}

function applyAppToNode(node: GraphNode, app: AppManifest, asTrigger: boolean, prompt: string): GraphNode {
  const opHint = collectOps(prompt).find((hit) => hit.slug === app.slug);
  let op = opHint ? findOp(app, opHint.key) : asTrigger ? triggerOp(app) : actionOp(app);
  if (asTrigger && op.type !== "trigger") op = triggerOp(app);
  if (!asTrigger && op.type === "trigger") op = actionOp(app);
  const next = makeNode({
    id: node.id,
    forceTrigger: asTrigger,
    app,
    op,
    y: node.position?.y ?? (asTrigger ? 40 : 200),
    x: node.position?.x,
    config: { ...defaultConfig(app.slug, op.key, {}), ...(app.slug === node.appSlug ? node.config : {}) }
  });
  return {
    ...next,
    connectionId: app.slug === node.appSlug ? node.connectionId ?? null : null
  };
}

export function refineGraph(prompt: string, graph: WorkflowGraph): { graph: WorkflowGraph; changed: boolean; rebuilt: boolean } {
  if (!graph.nodes?.length) {
    return { graph: graphFromPrompt(prompt), changed: true, rebuilt: true };
  }

  const rebuild = /\b(rebuild|start over|from scratch)\b/i.test(prompt);
  const apps = mentionedApps(prompt);
  const triggerFocused = /\b(trigger|when|whenever)\b/i.test(prompt);
  const actionFocused = /\b(action|then\b|append|send |post to|http request)\b/i.test(prompt) && !triggerFocused;

  if (rebuild || (isGenericGraph(graph) && apps.length > 1 && !triggerFocused && !actionFocused)) {
    return { graph: graphFromPrompt(prompt), changed: true, rebuilt: true };
  }

  const next = cloneGraph(graph);
  let changed = false;
  const trigger = next.nodes.find((node) => node.type === "trigger");
  const actions = next.nodes.filter((node) => node.type !== "trigger");

  if (trigger && triggerFocused && apps[0]) {
    const updated = applyAppToNode(trigger, apps[0], true, prompt);
    next.nodes = next.nodes.map((node) => (node.id === trigger.id ? updated : node));
    changed = true;
    if (apps[1] && actions[0]) {
      const actionNode = applyAppToNode(actions[0], apps[1], false, prompt);
      next.nodes = next.nodes.map((node) => (node.id === actions[0].id ? actionNode : node));
    }
  } else if (apps[0] && (actionFocused || !triggerFocused)) {
    const placeholder = actions.find((node) => PLACEHOLDER_APPS.has(node.appSlug)) ?? actions[0];
    if (placeholder) {
      const actionNode = applyAppToNode(placeholder, apps[0], false, prompt);
      next.nodes = next.nodes.map((node) => (node.id === placeholder.id ? actionNode : node));
      changed = true;
    } else if (trigger && PLACEHOLDER_APPS.has(trigger.appSlug) && triggerOp(apps[0]).type === "trigger") {
      next.nodes = next.nodes.map((node) => (node.id === trigger.id ? applyAppToNode(trigger, apps[0], true, prompt) : node));
      changed = true;
    }
  }

  if (/\b(fix|incomplete|map fields|map the fields|authenticate|connect accounts|finish)\b/i.test(prompt)) {
    const repaired = repairIncompleteGraph(next);
    return { graph: repaired.graph, changed: changed || repaired.changed, rebuilt: false };
  }

  if (!changed && mentionsWorkflowIntent(prompt) && isGenericGraph(graph)) {
    return { graph: graphFromPrompt(prompt), changed: true, rebuilt: true };
  }

  return { graph: next, changed, rebuilt: false };
}

export function shouldRefineFromChat(prompt: string) {
  if (isExplainOnlyPrompt(prompt)) return false;
  if (/\b(fix|incomplete|map fields|authenticate|connect accounts|finish)\b/i.test(prompt)) return true;
  if (mentionsWorkflowIntent(prompt)) return true;
  return /\b(use|change|switch|replace|set|add|instead)\b/i.test(prompt) && mentionedApps(prompt).length > 0;
}

export function explainLastTest(lastTest?: { ok?: boolean; ms?: number; body?: unknown } | null) {
  if (!lastTest) {
    return "I don't have a test result yet. Click Test workflow (or test a step), then ask me to explain it.";
  }
  const duration = lastTest.ms != null ? (lastTest.ok ? ` in ${lastTest.ms}ms` : ` after ${lastTest.ms}ms`) : "";
  if (lastTest.ok) {
    const preview = JSON.stringify(lastTest.body ?? {}).slice(0, 160);
    return `The last test succeeded${duration}. Sample output: ${preview}.`;
  }
  const raw = JSON.stringify(lastTest.body ?? "");
  if (/xoxe|xoxb|xoxp/i.test(raw) && /openai|incorrect api key/i.test(raw)) {
    return `The last test failed${duration} because the OpenAI account is using a Slack token (starts with xoxe), not an OpenAI key. Updating .env does not replace a saved connection. Open the OpenAI step → Setup → Reconnect, paste a key that starts with sk- from https://platform.openai.com/api-keys, then test that step. Copilot will not publish.`;
  }
  const preview = raw.replace(/\s+/g, " ").slice(0, 180);
  return `The last test failed${duration}. ${preview} Fix that step or reconnect the account, then test again. Copilot will not publish.`;
}

export async function copilotChat(opts: {
  prompt: string;
  graph?: WorkflowGraph;
  plan?: string;
  workspaceId?: string | null;
  automationId?: string;
  userEmail?: string | null;
  userId?: string;
  organizationId?: string;
  mode?: CopilotMode;
  selectedStepId?: string | null;
  lastTest?: { ok?: boolean; body?: unknown; ms?: number } | null;
}): Promise<{
  reply: string;
  source: string;
  graph?: WorkflowGraph;
  summary?: string;
  applied?: boolean;
  chapter?: string;
  youDoFirst?: string[];
  iCan?: string[];
  outline?: string;
}> {
  const mode = parseCopilotMode(opts.mode);
  const steps = opts.graph?.nodes?.length ?? 0;
  const labels = (opts.graph?.nodes ?? []).map((n) => n.label || n.operation || n.type).join(" → ");
  const incomplete = (opts.graph?.nodes ?? []).filter((n) => !n.operation).length;
  const plan = opts.plan ?? "free";
  const snapshot = inspectDraft(opts.graph);

  const finish = async (result: {
    reply: string;
    source: string;
    graph?: WorkflowGraph;
    summary?: string;
    chapter?: string;
  }) => {
    const snap = inspectDraft(result.graph ?? opts.graph);
    const applied = Boolean(result.graph) && copilotShouldPersist(mode) && result.chapter !== "inspect" && result.chapter !== "explain" && result.chapter !== "diagnose";
    if (result.graph && opts.automationId && opts.workspaceId && applied) {
      try {
        const { persistCopilotDraft } = await import("../flow-versions");
        await persistCopilotDraft({ automationId: opts.automationId, workspaceId: opts.workspaceId, graph: result.graph });
      } catch {
        /* chat still returns the graph so the canvas can apply it */
      }
    }
    if (opts.organizationId && opts.workspaceId) {
      await query(
        `insert into copilot_actions (organization_id, workspace_id, automation_id, user_id, prompt, stage, payload)
         values ($1,$2,$3,$4,$5,'chat',$6)`,
        [
          opts.organizationId,
          opts.workspaceId,
          opts.automationId ?? null,
          opts.userId ?? null,
          opts.prompt,
          JSON.stringify({
            source: result.source,
            summary: result.summary,
            published: false,
            mode,
            applied,
            chapter: result.chapter
          })
        ]
      ).catch(() => undefined);
    }
    return { ...result, applied, youDoFirst: snap.youDoFirst ?? [], iCan: snap.iCan ?? [], outline: snap.outline };
  };

  if (/\bpublish\b/i.test(opts.prompt)) {
    return finish({
      reply: "Copilot cannot publish a workflow. Review the draft, then use Publish yourself.",
      source: "copilot",
      chapter: "inspect"
    });
  }

  if (/explain the last test/i.test(opts.prompt)) {
    return finish({
      reply: `${describeDraft(snapshot)} ${explainLastTest(opts.lastTest)}`,
      source: "copilot",
      chapter: "diagnose"
    });
  }

  if (/\b(what.*(?:next|happening|wrong)|how.*fix|why.*(?:fail|not)|status)\b/i.test(opts.prompt)) {
    return finish({
      reply: await adviseWorkflow({ graph: opts.graph, lastTest: opts.lastTest }),
      source: "workflow-advisor",
      chapter: "diagnose"
    });
  }

  // Platform-level questions the orchestrator cannot answer
  if (/\b(what (?:integrations?|apps?|actions?|triggers?) (?:are |is )?(?:available|supported|can i)|list (?:integrations?|apps?|connections?))\b/i.test(opts.prompt)) {
    const { listIntegrations } = await import("./copilot-tools");
    const result = await listIntegrations();
    const apps = (result.data as Array<{ slug: string; name: string; operationCount: number }> | undefined) ?? [];
    const top = apps.slice(0, 20).map((a) => `${a.name} (${a.operationCount} operations)`).join(", ");
    return finish({
      reply: `Your platform supports ${apps.length} integrations including: ${top}${apps.length > 20 ? "…" : ""}. Describe a workflow to get started, or pick an app on the canvas.`,
      source: "copilot-tools",
      chapter: "explain"
    });
  }

  if (/\b(what connections? (?:do i|have|are)|my connected accounts?)\b/i.test(opts.prompt)) {
    const { listConnections } = await import("./copilot-tools");
    const result = await listConnections({ workspaceId: opts.workspaceId ?? "", userId: opts.userId ?? "" });
    const conns = (result.data as Array<{ pieceName: string; label: string; status: string }> | undefined) ?? [];
    if (!conns.length) {
      return finish({ reply: "You have no connected accounts yet. Add a step to the workflow and connect an account in Setup.", source: "copilot-tools", chapter: "explain" });
    }
    const list = conns.map((c) => `${c.label} (${c.pieceName}) — ${c.status}`).join("\n• ");
    return finish({ reply: `Your connected accounts:\n• ${list}`, source: "copilot-tools", chapter: "explain" });
  }

  if (/\b(hi|hello|hey|thanks|thank you)[\s!.]*$/i.test(opts.prompt.trim())) {
    return finish({
      reply: snapshot.empty
        ? "Hello! Describe the workflow you want to build — for example: 'When a Gmail arrives, send a Slack message.'"
        : `Hello! Your ${snapshot.nodeCount}-step workflow is ready. ${snapshot.youDoFirst?.[0] ?? "Review the steps, test, then publish."}`,
      source: "copilot",
      chapter: "inspect"
    });
  }

  const turn = orchestrateCopilot({
    prompt: opts.prompt,
    graph: opts.graph,
    selectedStepId: opts.selectedStepId,
    mode
  });

  if (turn.chapter === "rebuild") {
    const built = await copilotGraph(opts.prompt, opts.workspaceId, {
      userEmail: opts.userEmail,
      automationId: opts.automationId,
      mode,
      graph: opts.graph,
      selectedStepId: opts.selectedStepId
    });
    const limitNote =
      plan === "free" && built.graph.nodes.length > 2
        ? " You can draft every step here; Free plans meter extra tasks when you publish."
        : "";
    return finish({
      reply: `${built.summary}${limitNote}`,
      source: built.source,
      graph: built.graph,
      summary: built.summary,
      chapter: "rebuild"
    });
  }

  if (turn.graph && turn.changed) {
    const graph = await bindExistingConnections(turn.graph, opts.workspaceId, opts.userEmail);
    return finish({
      reply: turn.reply,
      source: "copilot-orchestrator",
      graph,
      summary: turn.reply,
      chapter: turn.chapter
    });
  }

  if (turn.chapter === "inspect" || turn.chapter === "explain" || !turn.changed) {
    return finish({ reply: turn.reply, source: "copilot-orchestrator", chapter: turn.chapter });
  }

  return finish({
    reply: steps
      ? turn.reply
      : `I can see ${steps || 0} steps${labels ? ` (${labels})` : ""}.${incomplete ? ` ${incomplete} still need an app/event.` : ""}`,
    source: "copilot-orchestrator",
    chapter: turn.chapter
  });
}
