import type { AppManifest, AppOperation, GraphNode, WorkflowGraph } from "@algoverge/shared";
import { env } from "../config";
import { APP_CATALOG } from "../catalog/catalog";
import { query } from "../db";
import { pickForCopilot } from "../connections";
import { pieceRegistry } from "../pieces/registry";
import { completeAi } from "../ai-runtime";
import { copilotShouldPersist, parseCopilotMode, type CopilotMode } from "./copilot-pipeline";
import {
  classifyCopilotChapter,
  describeDraft,
  inspectDraft,
  isStarterDraft,
  mentionedSlugs,
  orchestrateCopilot,
  type DraftSnapshot
} from "./copilot-orchestrator";
import { adviseWorkflow } from "../workflow-advisor";
import { ragGraphFromPrompt } from "./copilot-rag";

/**
 * Strip leaked chain-of-thought from LLM responses.
 * Models sometimes ignore instructions and expose internal reasoning.
 * This helper cleans the most common patterns.
 */
function stripThinking(text: string): string {
  if (!text) return text;
  let cleaned = text;
  // Remove "Thinking..." prefix
  cleaned = cleaned.replace(/^\s*Thinking\.\.\.\s*/i, "");
  // Aggressive chain-of-thought removal — patterns that expose internal LLM reasoning
  const thinkingPatterns = [
    /^(?:The user is asking me to|The user wants me to|Let me (?:analyze|think|consider|look|check|examine|inspect|understand|review)|I should (?:first|start|begin|check|look|analyze)|Looking at (?:the|this|what)|Given the context|The user might be|I need to (?:first|check|look|see|understand|analyze)|Wait\s*[-—,]|But wait\s*[-—,]|Actually\s*[-—,]|Now\s*[-—,]|So\s*[-—,]).*$/gm,
    /^\d+\.\s+(?:The user|Let me|I should|I need|Looking|Given|The workflow|Step \d)/gm,
    /^\s*(?:First,|Second,|Third,)?\s*(?:I(?:'ll| will| should| need to| can)|Let me|The user|Looking at|Given that|I notice|I see that|The current state)/gm,
    /(?:I can see you have|This appears to be|The user said|Let me first test|But first,|But I need to know|I need to see what)/g,
    /(?:Let me explain what(?:'s| is) needed|ask for the action step direction|explain what(?:'s| is) needed and ask)/g,
  ];
  for (const pat of thinkingPatterns) {
    cleaned = cleaned.replace(pat, (match) => {
      const lower = match.toLowerCase();
      if (/^(first|second|third),?\s+(?:let me|i should|i need)/i.test(lower)) return "";
      return match;
    });
  }
  // Collapse multiple blank lines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}

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
  { re: /\bopenai\b|chatgpt|\bsummariz(?:e|ing|y)\b|\bllm\b/i, slug: "openai" },
  { re: /claude|anthropic/i, slug: "anthropic" },
  { re: /gemini/i, slug: "gemini" },
  { re: /\bform\b|\bsubmission\b|\bsubmitted\b/i, slug: "forms" },
  { re: /table row|new record/i, slug: "tables" },
  { re: /shopify/i, slug: "shopify" },
  { re: /klaviyo/i, slug: "klaviyo" },
  { re: /asana/i, slug: "asana" },
  { re: /trello/i, slug: "trello" },
  { re: /zendesk/i, slug: "zendesk" },
  { re: /docusign/i, slug: "docusign" },
  { re: /\brss\b/i, slug: "rss" },
  { re: /outlook/i, slug: "outlook" },
  { re: /\bsend(?:\s+(?:it|the|a|to))?\s+(?:to\s+)?slack\b|\bslack\b/i, slug: "slack" },
  { re: /\bsave\s+(?:it|the|result|data|to)\s+(?:to\s+)?(?:google\s+)?sheets?\b|\bsheets?\b/i, slug: "google-sheets" },
  { re: /\bsend\s+(?:it|the|a|email|message)\s+(?:to\s+)?(?:via\s+)?(?:google\s+)?gmail\b|\bgmail\b/i, slug: "gmail" },
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

  // Detect ALL apps mentioned in the prompt, in order of appearance
  const detectedSlugs = mentionedSlugs(prompt);
  const placeholderSlugs = new Set(["webhook", "http", "manual"]);

  // If we detected at least one real app, build a chain
  if (detectedSlugs.length > 0) {
    // First app with a trigger becomes the trigger; rest are actions
    let triggerIdx = detectedSlugs.findIndex((slug: string) => {
      const app = appBySlug(slug);
      return app?.operations.some((o: AppOperation) => o.type === "trigger");
    });
    // If no app has a trigger, use the first detected app as trigger anyway
    if (triggerIdx === -1) triggerIdx = 0;

    const triggerSlug = detectedSlugs[triggerIdx];
    const actionSlugs = detectedSlugs.filter((_: string, i: number) => i !== triggerIdx);

    const tApp = appBySlug(triggerSlug)!;
    const tOp = triggerOp(tApp);
    const nodes: GraphNode[] = [
      makeNode({ id: "trigger", forceTrigger: true, app: tApp, op: tOp, y: 40, config: defaultConfig(tApp.slug, tOp.key, {}) })
    ];
    const edges: WorkflowGraph["edges"] = [];
    let prev = "trigger";
    actionSlugs.forEach((slug: string, i: number) => {
      const app = appBySlug(slug);
      if (!app) return;
      const op = actionOp(app);
      const id = `${slug.replace(/[^a-z0-9]/gi, "")}-${op.key}`;
      nodes.push(makeNode({ id, app, op, y: 200 + i * 160, config: defaultConfig(slug, op.key, {}) }));
      edges.push({ id: `e-${prev}-${id}`, source: prev, target: id });
      prev = id;
    });
    if (nodes.length === 1) {
      // Only trigger detected, add a placeholder action
      const http = appBySlug("http")!;
      nodes.push(makeNode({ id: "action", app: http, op: actionOp(http), y: 200, config: {} }));
      edges.push({ id: "e-t-a", source: "trigger", target: "action" });
    }
    return { nodes, edges };
  }

  // Absolute fallback: manual trigger + HTTP action
  const tApp = appBySlug("manual")!;
  const httpApp = appBySlug("http")!;
  return {
    nodes: [
      makeNode({ id: "trigger", forceTrigger: true, app: tApp, op: triggerOp(tApp), y: 40, config: {} }),
      makeNode({ id: "action", app: httpApp, op: actionOp(httpApp), y: 200, config: {} })
    ],
    edges: [{ id: "e-t-a", source: "trigger", target: "action" }]
  };
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

  // Try product-aware system planner for multi-product requests
  try {
    const { planSystem, planToGraph } = await import("./system-planner");
    const { searchKnowledge } = await import("./knowledge-rag");
    const knowledge = searchKnowledge(trimmed, { k: 3 });
    const systemPlan = planSystem({ prompt: trimmed, graph: opts?.graph, knowledge });
    if (systemPlan.steps.length >= 2 && systemPlan.confidence > 0.5) {
      const planGraph = planToGraph(systemPlan, APP_CATALOG as any);
      if (planGraph.nodes.length >= 2 && planGraph.edges.length > 0) {
        return done(planGraph, "system-planner", describeGraph(planGraph), {
          rebuilt: true,
          chapter: "rebuild",
          changed: true
        });
      }
    }
  } catch {
    /* System planner unavailable — fall through to other methods */
  }

  // Try RAG-based graph construction (hybrid vector + lexical catalog search)
  try {
    const ragGraph = await ragGraphFromPrompt(trimmed, pieceRegistry);
    if (ragGraph && ragGraph.nodes.length >= 2 && ragGraph.edges.length > 0) {
      return done(ragGraph, "copilot-rag", describeGraph(ragGraph), {
        rebuilt: true,
        chapter: "rebuild",
        changed: true
      });
    }
  } catch {
    /* RAG unavailable — fall through to regex */
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
  return /\b(use|change|switch|replace|set|add|instead|update|modify)\b/i.test(prompt) && mentionedApps(prompt).length > 0;
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

export type CopilotSuggestion = { label: string; prompt: string; icon?: "zap" | "check" | "arrow" | "pencil" | "alert" };
export type CopilotClarification = { question: string; options: Array<{ label: string; prompt: string; description?: string }> };
export type CopilotOperation = { title: string; steps: Array<{ label: string; status: "pending" | "running" | "completed" | "failed" | "skipped"; detail?: string }>; status: "running" | "completed" | "failed"; actions?: Array<{ label: string; prompt: string }> };

/** Generate context-aware clickable suggestion badges based on workflow state */
function generateSuggestions(
  chapter: string,
  snapshot: { empty: boolean; nodeCount: number; steps: Array<{ issues: string[]; chapter: string; appSlug: string; type: string }> },
  graph?: WorkflowGraph,
  selectedStepId?: string | null
): CopilotSuggestion[] {
  // If a node is selected, show node-specific suggestions first
  if (selectedStepId && graph) {
    const node = graph.nodes.find((n) => n.id === selectedStepId);
    if (node) {
      const nodeApp = APP_CATALOG.find((a) => a.slug === node.appSlug);
      const nodeOp = nodeApp?.operations.find((o) => o.key === node.operation);
      const nodeSuggestions: CopilotSuggestion[] = [];
      
      // Explain this node
      nodeSuggestions.push({ label: `Explain ${node.label ?? "this step"}`, prompt: `Explain this ${node.type} step`, icon: "check" });
      
      // Test this node
      nodeSuggestions.push({ label: `Test ${node.label ?? "this step"}`, prompt: `Test this ${node.type} step`, icon: "zap" });
      
      // Node-specific actions based on app type
      if (node.appSlug === "google-sheets") {
        nodeSuggestions.push({ label: "Map fields", prompt: "Map fields from previous steps to this sheet", icon: "pencil" });
        nodeSuggestions.push({ label: "Change sheet", prompt: "Change the spreadsheet or sheet for this step", icon: "pencil" });
      } else if (node.appSlug === "gmail" || node.appSlug === "outlook") {
        nodeSuggestions.push({ label: "Change recipient", prompt: "Change who receives this email", icon: "pencil" });
        nodeSuggestions.push({ label: "Edit template", prompt: "Edit the email template", icon: "pencil" });
      } else if (node.appSlug === "slack") {
        nodeSuggestions.push({ label: "Change channel", prompt: "Change the Slack channel for this step", icon: "pencil" });
        nodeSuggestions.push({ label: "Edit message", prompt: "Edit the Slack message template", icon: "pencil" });
      } else if (node.appSlug === "openai" || node.appSlug === "anthropic" || node.appSlug === "gemini") {
        nodeSuggestions.push({ label: "Edit prompt", prompt: "Edit the AI prompt for this step", icon: "pencil" });
        nodeSuggestions.push({ label: "Change model", prompt: "Change the AI model for this step", icon: "pencil" });
      } else if (node.appSlug === "paths" || node.appSlug === "filter") {
        nodeSuggestions.push({ label: "Edit condition", prompt: "Edit the condition for this step", icon: "pencil" });
        nodeSuggestions.push({ label: "Add branch", prompt: "Add another branch", icon: "arrow" });
      }
      
      // Universal node actions
      nodeSuggestions.push({ label: "Add step after", prompt: "Add the next step after this one", icon: "arrow" });
      
      // If there are issues on this node
      if (snapshot.steps.some((s) => s.issues.length > 0)) {
        nodeSuggestions.push({ label: "Fix issues", prompt: "Fix all workflow issues", icon: "alert" });
      }
      
      return nodeSuggestions.slice(0, 8);
    }
  }
  
  if (snapshot.empty) {
    return [
      { label: "Gmail \u2192 Slack", prompt: "When a new Gmail arrives, send a summary to Slack", icon: "zap" },
      { label: "Calendar \u2192 Sheets", prompt: "When a new calendar event is created, add it to Google Sheets", icon: "zap" },
      { label: "Form \u2192 Email", prompt: "When a form is submitted, send a confirmation email", icon: "zap" },
      { label: "Webhook \u2192 HTTP", prompt: "When a webhook arrives, POST the body to an HTTP endpoint", icon: "zap" },
      { label: "Lead \u2192 AI \u2192 Sheets", prompt: "When a new lead arrives, analyze with AI and save to Sheets", icon: "zap" },
      { label: "Schedule \u2192 AI", prompt: "Every morning, summarize tasks with AI and send to Slack", icon: "zap" },
    ];
  }
  const suggestions: CopilotSuggestion[] = [];
  if (chapter === "inspect" || chapter === "explain") {
    suggestions.push({ label: "Explain this flow", prompt: "Explain this workflow in detail", icon: "check" });
    suggestions.push({ label: "Find problems", prompt: "Find problems in this workflow", icon: "alert" });
  }
  if (chapter === "rebuild" || chapter === "add_step") {
    suggestions.push({ label: "Add AI step", prompt: "Add an AI processing step", icon: "zap" });
    suggestions.push({ label: "Add condition", prompt: "Add a condition/branch after this step", icon: "pencil" });
    suggestions.push({ label: "Add notification", prompt: "Add a notification step", icon: "arrow" });
  }
  if (snapshot.steps.some((s) => s.issues.length > 0)) {
    suggestions.push({ label: "Fix issues", prompt: "Fix all workflow issues", icon: "alert" });
  }
  suggestions.push({ label: "Test workflow", prompt: "Test this workflow", icon: "zap" });
  suggestions.push({ label: "Add a step", prompt: "Add the next step", icon: "arrow" });
  suggestions.push({ label: "Optimize", prompt: "Optimize this workflow", icon: "check" });
  return suggestions;
}

/** Generate a clarification question when the request is ambiguous */
function generateClarification(
  prompt: string,
  snapshot: { empty: boolean; nodeCount: number },
  chapter?: string
): CopilotClarification | undefined {
  if (!snapshot.empty) return undefined;
  if (chapter === "rebuild") return undefined;
  const lower = prompt.toLowerCase();
  if (/lead|prospect|customer/i.test(lower) && !/form|webhook|sheet|email|slack|notify|crm/i.test(lower)) {
    return {
      question: "Where do your leads come from?",
      options: [
        { label: "Form submission", prompt: "Create a lead automation: When someone submits a form, use AI to qualify the lead, add qualified leads to Google Sheets, and send a WhatsApp notification", description: "Website form, Typeform, etc." },
        { label: "Google Sheets", prompt: "Create a lead automation: When a new row is added to Google Sheets, use AI to qualify the lead, add qualified leads to Google Sheets, and notify via Slack", description: "New row added to a sheet" },
        { label: "Webhook", prompt: "Create a lead automation: When a webhook fires, use AI to qualify the lead, add qualified leads to Google Sheets, and send an email notification", description: "HTTP POST from any source" },
        { label: "CRM integration", prompt: "Create a lead automation: When a new deal is created in HubSpot, use AI to qualify the lead, add qualified leads to Google Sheets, and notify via Slack", description: "New deal or contact" },
      ]
    };
  }
  if (/automat|workflow|zap|pipeline/i.test(lower) && !/form|webhook|sheet|email|slack|notify|trigger|when|whenever/i.test(lower)) {
    return {
      question: "What should this automation do?",
      options: [
        { label: "Send notifications", prompt: "Send email or Slack notifications", description: "Notify team of events" },
        { label: "Sync data between apps", prompt: "Sync data between applications", description: "Keep data in sync" },
        { label: "Process with AI", prompt: "Process data with AI", description: "Classify, summarize, or extract" },
        { label: "Create records", prompt: "Create records in a database or CRM", description: "Add rows, contacts, etc." },
      ]
    };
  }
  if (/schedule|cron|every|daily|weekly|monthly/i.test(lower) && !/trigger|when|webhook|form/i.test(lower)) {
    return {
      question: "What should happen on schedule?",
      options: [
        { label: "Send report email", prompt: "Send a scheduled report email", description: "Daily/weekly summary" },
        { label: "Sync data", prompt: "Sync data between apps on schedule", description: "Pull from one app, push to another" },
        { label: "Run AI analysis", prompt: "Run AI analysis on schedule", description: "Process and summarize data" },
        { label: "Check and notify", prompt: "Check conditions and notify if needed", description: "Monitor and alert" },
      ]
    };
  }
  return undefined;
}

/** Generate suggestions for the Python agent path */
export function generateSuggestionsForAgent(
  prompt: string,
  reply: string,
  graph?: WorkflowGraph,
  needsInput?: string[]
): CopilotSuggestion[] {
  const suggestions: CopilotSuggestion[] = [];
  if (!graph?.nodes?.length) {
    suggestions.push({ label: "Create workflow", prompt: "Create a new workflow", icon: "zap" });
    suggestions.push({ label: "Explain integrations", prompt: "What integrations are available?", icon: "check" });
  } else {
    suggestions.push({ label: "Test workflow", prompt: "Test this workflow", icon: "zap" });
    suggestions.push({ label: "Add a step", prompt: "Add the next step", icon: "arrow" });
    suggestions.push({ label: "Explain this flow", prompt: "Explain this workflow", icon: "check" });
  }
  if (needsInput?.length) {
    suggestions.push({ label: "Show options", prompt: "What are my options?", icon: "pencil" });
  }
  if (/lead|customer|prospect/i.test(prompt)) {
    suggestions.push({ label: "Add AI qualification", prompt: "Add an AI qualification step", icon: "zap" });
    suggestions.push({ label: "Send notification", prompt: "Add a notification step", icon: "arrow" });
  }
  if (/fail|error|broken/i.test(prompt)) {
    suggestions.push({ label: "Show errors", prompt: "Show me the errors", icon: "alert" });
    suggestions.push({ label: "Retry run", prompt: "Retry the failed run", icon: "arrow" });
  }
  return suggestions.slice(0, 6);
}

/** Generate clarification for the Python agent path */
export function generateClarificationForAgent(
  prompt: string,
  needsInput: string[]
): CopilotClarification | undefined {
  if (!needsInput.length) return undefined;
  const lower = prompt.toLowerCase();
  if (/lead|prospect|customer/i.test(lower)) {
    return {
      question: "Where do your leads come from?",
      options: [
        { label: "Form submission", prompt: "Use a form submission trigger", description: "Website form, Typeform, etc." },
        { label: "Google Sheets", prompt: "Use Google Sheets trigger for new rows", description: "New row added to a sheet" },
        { label: "Webhook", prompt: "Use a webhook trigger", description: "HTTP POST from any source" },
        { label: "CRM integration", prompt: "Use CRM trigger (HubSpot, Salesforce)", description: "New deal or contact" },
      ]
    };
  }
  if (/automat|workflow|zap|pipeline/i.test(lower)) {
    return {
      question: "What should this automation do?",
      options: [
        { label: "Send notifications", prompt: "Send email or Slack notifications", description: "Notify team of events" },
        { label: "Sync data between apps", prompt: "Sync data between applications", description: "Keep data in sync" },
        { label: "Process with AI", prompt: "Process data with AI", description: "Classify, summarize, or extract" },
        { label: "Create records", prompt: "Create records in a database or CRM", description: "Add rows, contacts, etc." },
      ]
    };
  }
  return {
    question: `I need more information: ${needsInput[0]}`,
    options: [
      { label: "Form trigger", prompt: "Use a form submission trigger" },
      { label: "Webhook trigger", prompt: "Use a webhook trigger" },
      { label: "Schedule trigger", prompt: "Use a schedule trigger" },
      { label: "Skip for now", prompt: "Skip and use defaults" },
    ]
  };
}

/** Generate operation cards showing workflow creation progress */
function generateOperations(
  result: { graph?: WorkflowGraph; chapter?: string; source: string; applied?: boolean },
  snapshot: { empty: boolean; nodeCount: number; steps: Array<{ label: string; appSlug: string; type: string; chapter: string; issues: string[] }> }
): CopilotOperation[] {
  if (!result.graph || result.chapter === "inspect" || result.chapter === "explain" || result.chapter === "diagnose") return [];
  if (snapshot.empty) return [];
  const steps = snapshot.steps.map((s) => ({
    label: `${s.label} (${s.appSlug})`,
    status: s.issues.length > 0 ? ("failed" as const) : ("completed" as const),
    detail: s.issues.length > 0 ? s.issues[0] : undefined,
  }));
  const allOk = steps.every((s) => s.status === "completed");
  return [{
    title: result.applied ? "Workflow updated" : "Workflow planned",
    steps,
    status: allOk ? "completed" : steps.some((s) => s.status === "failed") ? "failed" : "running",
    actions: allOk
      ? [
          { label: "Test workflow", prompt: "Test this workflow" },
          { label: "Add a step", prompt: "Add the next step" },
        ]
      : [
          { label: "Fix issues", prompt: "Fix all workflow issues" },
        ],
  }];
}

/** Detect whether the prompt is a general conversational question rather
 * than a workflow build/modify/test/diagnose request. */
function isConversationalQuestion(prompt: string, snapshot: DraftSnapshot): boolean {
  const lower = prompt.toLowerCase().trim();
  // Short greetings — already handled above, but guard double-match
  if (/^(hi|hello|hey|thanks|thank you)[\s!.?]*$/i.test(lower)) return false;
  // Already handled by explicit patterns above (help, who-are-you, explain, publish)
  if (/\b(what can you do|capabilities|features|who are you|your name|publish|turn on)\b/i.test(lower)) return false;
  // Workflow-modification keywords → not conversational
  if (/\b(build|generate|create|add|insert|append|remove|delete|replace|change|switch|set|use|fix|fill|map|autocomplete|connect|authenticate|rebuild|start over|update|modify)\b/i.test(lower)) return false;
  if (/\b(when |whenever |then |also )\b/i.test(lower) && snapshot.generic) return false;
  // If the prompt is a question (contains ?) or a general knowledge phrase, route to LLM
  const isQuestion = lower.includes("?");
  const hasQuestionWord = /^(what|how|why|where|when|who|which|can|could|should|would|is|are|do|does|will)\b/i.test(lower);
  // Longer free-form text that doesn't look like a workflow instruction
  const looksLikeFreeForm = lower.length > 12 && !mentionsWorkflowIntent(prompt);
  return isQuestion || hasQuestionWord || looksLikeFreeForm;
}

/** Use the LLM to answer a general conversational question with workflow context. */
async function answerWithLlm(
  prompt: string,
  graph: WorkflowGraph | undefined,
  snapshot: DraftSnapshot,
  history?: Array<{ role: "user" | "assistant"; content: string; ts?: string }>,
): Promise<string | null> {
  const catalogSummary = APP_CATALOG.slice(0, 40)
    .map((a) => `${a.name} (${a.slug}): ${a.operations.map((o) => o.key).join(", ")}`)
    .join("\n");
  const workflowContext = snapshot.empty
    ? "The canvas is currently empty — no steps configured yet."
    : `Current workflow (${snapshot.nodeCount} steps):\n${snapshot.steps.map((s) => `${s.index}. ${s.label} (${s.appSlug}) [${s.chapter}]`).join("\n")}`;
  const system = [
    "You are Orchestra Copilot, a concise workflow automation assistant.",
    "CRITICAL: Never expose chain-of-thought, internal reasoning, or thinking-out-loud in your response.",
    "NEVER start with 'Let me analyze', 'I should first', 'Looking at', 'The user might be', or numbered internal analysis.",
    "Start directly with the conclusion or answer. Be confident and direct.",
    "Answer the user's question helpfully and concisely.",
    "If the question is about their current workflow, use the provided workflow context.",
    "If it's a general knowledge question about automation, integrations, or the platform, answer it.",
    "Keep answers to 2-4 short paragraphs max. Use markdown for readability.",
    "End with a clear next step when appropriate.",
  ].join(" ");

  // Build message with conversation history for multi-turn context
  const historyBlock = history?.length
    ? history.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n")
    : "";
  const userMessage = [
    `Available integrations:\n${catalogSummary}`,
    `\nWorkflow context:\n${workflowContext}`,
    historyBlock ? `\nConversation so far:\n${historyBlock}` : "",
    `\nUser question: ${prompt}`,
  ].filter(Boolean).join("\n");

  const result = await completeAi({
    intent: "reason",
    prompt: userMessage,
    system,
    piiFilter: false,
  });
  if (result.text) return result.text;
  return null;
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
  history?: Array<{ role: "user" | "assistant"; content: string; ts?: string }>;
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
  suggestions?: CopilotSuggestion[];
  clarification?: CopilotClarification;
  operations?: CopilotOperation[];
  thinking?: string;
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
    const suggestions = generateSuggestions(result.chapter ?? "inspect", snap, result.graph, opts.selectedStepId);
    const clarification = generateClarification(opts.prompt, snap, result.chapter);
    const operations = generateOperations(result, snap);
    // Strip any leaked chain-of-thought from the reply before sending to user
    // Generate contextual thinking text based on what the copilot did
    const chapter = result.chapter ?? "inspect";
    let thinking = "";
    if (chapter === "rebuild") {
      const nodeCount = result.graph?.nodes?.length ?? 0;
      thinking = `Assembled a ${nodeCount}-step workflow from your description.`;
    } else if (chapter === "add_step") {
      thinking = "Added a new step to your existing workflow.";
    } else if (chapter === "change_step") {
      thinking = "Updated the specified step in your workflow.";
    } else if (chapter === "fill_fields" || chapter === "autocomplete") {
      thinking = "Filled in empty fields using data from previous steps.";
    } else if (chapter === "explain") {
      thinking = "Reviewed the current workflow and prepared an explanation.";
    } else if (chapter === "diagnose") {
      thinking = "Analyzed the last test result for issues.";
    } else {
      const nodeCount = snap.nodeCount;
      thinking = nodeCount > 0
        ? `Inspected your ${nodeCount}-step workflow. ${snap.issues.length ? `${snap.issues.length} issue(s) found.` : "No issues found."}
${snap.youDoFirst?.length ? "You need to: " + snap.youDoFirst[0] : "Workflow looks ready to test."}`
        : "The canvas is empty. Describe a trigger and actions to get started.";
    }
    return { ...result, reply: stripThinking(result.reply), applied, youDoFirst: snap.youDoFirst ?? [], iCan: snap.iCan ?? [], outline: snap.outline, suggestions, clarification, operations, thinking };
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


  // ── Conversational responses (natural language) ────────────────────────
  if (/^(hi|hello|hey|howdy|how are you|what'?s up|hola|sup|yo)[\s!.?]*$/i.test(opts.prompt.trim())) {
    const nodeCount = opts.graph?.nodes?.length ?? 0;
    if (snapshot.empty) {
      return finish({
        reply: "Hey! I'm your AI automation assistant. I can help you:\n\n• Build workflows from a description\n• Modify existing automations\n• Explain what each step does\n• Find and fix problems\n• Test your workflows\n\nWhat would you like to automate?",
        source: "copilot",
        chapter: "inspect",
      });
    }
    return finish({
      reply: `Hey! I see your ${nodeCount}-step workflow (${labels}). ${snapshot.youDoFirst?.[0] ?? "What would you like me to help with?"}`,
      source: "copilot",
      chapter: "inspect",
    });
  }

  if (/\b(thanks?|thank you|thx|ty)\b/i.test(opts.prompt.trim())) {
    return finish({
      reply: "You're welcome! Let me know if you need anything else — happy to help."
        + (snapshot.nodeCount > 0 ? ` Your ${snapshot.nodeCount}-step workflow is looking good. ${snapshot.youDoFirst?.[0] ?? "Try testing it when you're ready."}` : ""),
      source: "copilot",
      chapter: "inspect",
    });
  }

  if (/\b(help|what can you do|capabilities|features)\b/i.test(opts.prompt)) {
    return finish({
      reply: `I can help you with:\n\n🔧 **Build workflows** — Describe what you want, I'll create it\n🔍 **Explain workflows** — Ask me about any step or the whole flow\n🐛 **Find problems** — I'll check for issues and suggest fixes\n⚡ **Add steps** — "Add Slack notification" or "Add AI processing"\n🧪 **Test workflows** — I'll validate your automation\n🔄 **Modify workflows** — Change triggers, actions, or conditions\n📊 **Check status** — Ask about recent runs, connections, or errors\n\nJust describe what you want naturally — I'll figure out the rest.`,
      source: "copilot",
      chapter: "explain",
    });
  }

  if (/\b(who are you|what are you|your name)\b/i.test(opts.prompt)) {
    return finish({
      reply: `I'm your AI Copilot — built right into your workflow builder. I understand your automations, connections, and execution history. I can build, explain, fix, and test workflows through natural conversation.\n\nTry something like:\n• "Create a lead automation"\n• "Why did my workflow fail?"\n• "Add a Slack notification after this step"\n• "Test this workflow"`,
      source: "copilot",
      chapter: "explain",
    });
  }

  if (/\b(how (?:does|do)|explain|what does|tell me about|describe) (?:this|the) (?:workflow|automation|flow|step|node|zap)\b/i.test(opts.prompt)) {
    if (opts.selectedStepId && opts.graph) {
      const selectedNode = opts.graph.nodes.find((n) => n.id === opts.selectedStepId);
      if (selectedNode) {
        const nodeApp = appBySlug(selectedNode.appSlug);
        const nodeOp = nodeApp?.operations.find((o) => o.key === selectedNode.operation);
        const nodeConfig = selectedNode.config ?? {};
        const configStr = Object.entries(nodeConfig).filter(([, v]) => v).map(([k, v]) => `• ${k}: ${v}`).join("\n");
        return finish({
          reply: `This step **${selectedNode.label ?? nodeOp?.name ?? selectedNode.appSlug}** (${selectedNode.appSlug}/${selectedNode.operation})\n\nType: ${selectedNode.type}\n${configStr ? `\nConfiguration:\n${configStr}` : "\nNo configuration set yet."}\n\n${nodeOp ? `This operation ${nodeOp.type === "trigger" ? "triggers when something happens" : "performs an action"} using ${nodeApp?.name ?? selectedNode.appSlug}.` : ""}`,
          source: "copilot",
          chapter: "explain",
        });
      }
    }
    return finish({
      reply: describeDraft(snapshot) + "\n\nWould you like me to explain a specific step? Click on a node and ask me about it.",
      source: "copilot",
      chapter: "explain",
    });
  }

  // Node-specific suggestions when a node is selected
  if (opts.selectedStepId && opts.graph) {
    const selectedNode = opts.graph.nodes.find((n) => n.id === opts.selectedStepId);
    if (selectedNode && /\b(what can|what do|options|actions?|do|configure|set up|help|configure)\b/i.test(opts.prompt)) {
      const nodeApp = appBySlug(selectedNode.appSlug);
      const nodeOp = nodeApp?.operations.find((o) => o.key === selectedNode.operation);
      const nodeSuggestions: CopilotSuggestion[] = [];
      if (nodeApp) {
        for (const field of nodeOp?.inputFields ?? []) {
          if (field.required) {
            nodeSuggestions.push({
              label: `Set ${field.label}`,
              prompt: `Configure the ${field.label} field for this step`,
              icon: "pencil",
            });
          }
        }
        if (selectedNode.type === "trigger") {
          nodeSuggestions.push({ label: "Test this trigger", prompt: "Test this trigger step", icon: "zap" });
        } else {
          nodeSuggestions.push({ label: "Test this step", prompt: "Test this action step", icon: "zap" });
        }
        nodeSuggestions.push({ label: "Replace with another app", prompt: "Replace this step with a different app", icon: "arrow" });
        nodeSuggestions.push({ label: "Add step after this", prompt: "Add the next step", icon: "arrow" });
        nodeSuggestions.push({ label: "Remove this step", prompt: "Remove this step", icon: "alert" });
      }
      const appName = nodeApp?.name ?? selectedNode.appSlug;
      const baseResult = await finish({
        reply: `This step is **${selectedNode.label ?? nodeOp?.name ?? appName}** using ${appName}. Here are some things I can help with:`,
        source: "copilot",
        chapter: "inspect",
      });
      return { ...baseResult, suggestions: nodeSuggestions.slice(0, 6) };
    }
  }

  // Platform-level questions the orchestrator cannot answer
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

  // Legacy greeting fallback (should not be reached due to handlers above)
  if (/\b(hi|hello|hey|thanks|thank you)[\s!.]*$/i.test(opts.prompt.trim())) {
    return finish({
      reply: snapshot.empty
        ? "Hello! Describe the workflow you want to build — for example: 'When a Gmail arrives, send a Slack message.'"
        : `Hello! Your ${snapshot.nodeCount}-step workflow is ready. ${snapshot.youDoFirst?.[0] ?? "Review the steps, test, then publish."}`,
      source: "copilot",
      chapter: "inspect"
    });
  }

  // ── LLM-powered conversational fallback ──────────────────────────────
  // When no workflow-modification pattern matched above, detect general
  // questions and use the LLM to answer them with full workflow context.
  const isConversational = isConversationalQuestion(opts.prompt, snapshot);
  if (isConversational) {
    try {
      const llmReply = await answerWithLlm(opts.prompt, opts.graph, snapshot, opts.history);
      if (llmReply) {
        return finish({ reply: stripThinking(llmReply), source: "copilot-llm", chapter: "explain" });
      }
    } catch {
      /* LLM unavailable — fall through to pattern engine */
    }
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

// ── System Planner (Level 1) ───────────────────────────────────────────────
// Decomposes user intent into products, capabilities, entry surface,
// and resource graph — like Zapier's product-level reasoning.

const PRODUCT_HINTS: Array<{ re: RegExp; product: string }> = [
  { re: /\b(form|submission|intake|capture form|web form)\b/i, product: "form" },
  { re: /\b(table|database|crm|sheet|spreadsheet|row|record|store)\b/i, product: "table" },
  { re: /\b(automat|workflow|zap|pipeline|flow|process)\b/i, product: "workflow" },
  { re: /\b(agent|ai agent|autonomous|tool.?call|reason)\b/i, product: "agent" },
  { re: /\b(chatbot|chat bot|assistant|support bot|qa bot)\b/i, product: "chatbot" },
  { re: /\b(dashboard|interface|view|ui|portal|app)\b/i, product: "interface" },
];

const CAPABILITY_HINTS: Array<{ re: RegExp; cap: string; product: string }> = [
  { re: /\b(form|submit|submission|intake|capture|collect|sign.?up|register|webhook|catch hook|collected|captures?)\b/i, cap: "collect", product: "form" },
  { re: /\b(store|save|record|database|table|crm|sheet|spreadsheet|row|log|add to|put in|stored|saving?)\b/i, cap: "store", product: "table" },
  { re: /\b(when|whenever|on new|every time|trigger|start|each time)\b/i, cap: "trigger", product: "workflow" },
  { re: /\b(ai|classify|analyze|summar|score|extract|parse|transform|enrich|qualif|identify|determine|qualified?|scoring?)\b/i, cap: "transform", product: "workflow" },
  { re: /\b(if|else|condition|branch|route|path|filter|hot|warm|cold|scored?|only when|unless|depending on)\b/i, cap: "decide", product: "workflow" },
  { re: /\b(send to|route to|forward|assign|distribute|escalat|routed?|sent to|sales)\b/i, cap: "route", product: "workflow" },
  { re: /\b(notif|alert|messag|slack|email|sms|whatsapp|telegram|discord|tell|inform|let know|remind|notified?)\b/i, cap: "notify", product: "workflow" },
  { re: /\b(search|find|lookup|check.*exist|check.*already)\b/i, cap: "search", product: "table" },
  { re: /\b(enrich|augment|score|rank|prioritiz|lead score)\b/i, cap: "enrich", product: "workflow" },
  { re: /\b(approve|confirm|review|human|approval|ask me)\b/i, cap: "approve", product: "workflow" },
];

const CONNECTION_HINTS: Array<{ re: RegExp; slug: string }> = [
  { re: /\b(slack)\b/i, slug: "slack" },
  { re: /\b(gmail|email)\b/i, slug: "gmail" },
  { re: /\b(google sheet|sheets?|spreadsheet)\b/i, slug: "google-sheets" },
  { re: /\b(google calendar|calendar)\b/i, slug: "google-calendar" },
  { re: /\b(hubspot|crm)\b/i, slug: "hubspot" },
  { re: /\b(salesforce)\b/i, slug: "salesforce" },
  { re: /\b(notion)\b/i, slug: "notion" },
  { re: /\b(github)\b/i, slug: "github" },
  { re: /\b(stripe|payment)\b/i, slug: "stripe" },
  { re: /\b(whatsapp)\b/i, slug: "whatsapp" },
];

export function planSystem(prompt: string) {
  const caps = CAPABILITY_HINTS.filter((h) => h.re.test(prompt));
  const products = [...new Set(PRODUCT_HINTS.filter((h) => h.re.test(prompt)).map((h) => h.product))];
  const connections = [...new Set(CONNECTION_HINTS.filter((h) => h.re.test(prompt)).map((h) => h.slug))];

  // Ensure products cover capability needs
  for (const c of caps) {
    if (!products.includes(c.product)) products.push(c.product);
  }
  if (!products.includes("workflow")) products.push("workflow");

  const capList = caps.map((c, i) => ({ type: c.cap, description: c.cap, product: c.product, app_hint: null as string | null, order: i, depends_on: [] as number[] }));
  const resourceGraph = capList.map((c, i) => ({ index: i, product: c.product, capability: c.type, description: c.description, app_hint: c.app_hint, depends_on: c.depends_on }));

  // Entry surface
  const productSet = new Set(products);
  let entrySurface = "flow_builder";
  if (productSet.size >= 3) entrySurface = "canvas";
  else if (productSet.has("form") && productSet.has("table") && productSet.size === 2) entrySurface = "form_builder";
  else if (productSet.has("chatbot")) entrySurface = "chatbot_builder";
  else if (productSet.has("agent") && !productSet.has("workflow")) entrySurface = "agent_builder";
  else if (capList.length >= 4) entrySurface = "canvas";

  const primary = productSet.has("workflow") ? "workflow" : products[0] || "workflow";
  const summaryParts: string[] = [];
  if (productSet.has("form")) summaryParts.push("Form for data collection");
  if (productSet.has("table")) summaryParts.push("Table for storage");
  if (productSet.has("workflow")) summaryParts.push("Workflow for automation");
  if (productSet.has("agent")) summaryParts.push("AI Agent for reasoning");
  if (productSet.has("chatbot")) summaryParts.push("Chatbot for user interaction");

  return {
    goal: prompt.slice(0, 200),
    summary: summaryParts.join(" + ") || "Automation workflow",
    capabilities: capList,
    products_used: products,
    entry_surface: entrySurface,
    primary_product: primary,
    resource_graph: resourceGraph,
    needs_connections: connections,
    confidence: Math.min(0.9, 0.5 + capList.length * 0.08),
    reasoning: `Detected ${capList.length} capabilities across ${products.length} products`,
    is_single_product: productSet.size <= 1 && capList.length <= 2,
    recommended_actions: [
      ...(productSet.has("form") ? ["Create a form to collect data"] : []),
      ...(productSet.has("table") ? ["Create a table to store records"] : []),
      ...(productSet.has("workflow") ? ["Create an automation workflow"] : []),
      ...(productSet.has("agent") ? ["Create an AI agent for intelligent processing"] : []),
      ...(connections.length ? [`Connect to: ${connections.join(", ")}`] : []),
    ],
  };
}
