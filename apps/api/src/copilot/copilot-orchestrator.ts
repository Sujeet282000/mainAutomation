import type { AppManifest, AppOperation, GraphNode, WorkflowGraph } from "@algoverge/shared";
import { APP_CATALOG } from "../catalog/catalog";
import type { CopilotMode } from "./copilot-pipeline";

export type CopilotChapter =
  | "inspect"
  | "explain"
  | "diagnose"
  | "fill_fields"
  | "autocomplete"
  | "add_step"
  | "change_step"
  | "rebuild";

export type StepChapter = "setup" | "configure" | "test";

export type StepSnapshot = {
  id: string;
  index: number;
  type: GraphNode["type"];
  appSlug: string;
  operation: string;
  label: string;
  connectionId: string | null;
  chapter: StepChapter;
  missingFields: string[];
  issues: string[];
  protected: true;
};

export type DraftSnapshot = {
  empty: boolean;
  generic: boolean;
  nodeCount: number;
  steps: StepSnapshot[];
  issues: string[];
  suggestions: string[];
  youDoFirst?: string[];
  iCan?: string[];
  outline: string;
};

const SKIP_AUTH = new Set(["webhook", "http", "manual", "schedule", "filter", "paths", "delay", "code", "email"]);

function appBySlug(slug: string) {
  return APP_CATALOG.find((a) => a.slug === slug);
}

function opOf(app: AppManifest | undefined, key: string): AppOperation | undefined {
  return app?.operations.find((o) => o.key === key);
}

function filled(value: unknown) {
  if (value === undefined || value === null) return false;
  return String(value).trim() !== "";
}

export function isStarterDraft(graph?: WorkflowGraph | null) {
  if (!graph?.nodes?.length) return true;
  return graph.nodes.every((n) => !n.appSlug || !n.operation);
}

function needsAuth(node: GraphNode, app?: AppManifest) {
  if (!app) return false;
  if ((app.authType ?? "none") === "none" || SKIP_AUTH.has(node.appSlug)) return false;
  return !node.connectionId;
}

export function inspectDraft(graph?: WorkflowGraph | null): DraftSnapshot {
  if (!graph?.nodes?.length) {
    return {
      empty: true,
      generic: true,
      nodeCount: 0,
      steps: [],
      issues: ["Canvas is empty. Add a trigger or describe the workflow."],
      suggestions: ["Describe the trigger and actions, or pick apps on the canvas."],
      youDoFirst: ["Add a trigger on the canvas, or describe the workflow in chat."],
      iCan: ["Outline a trigger and actions from a plain-language description."],
      outline: "(empty canvas)"
    };
  }

  const steps: StepSnapshot[] = graph.nodes.map((node, i) => {
    const app = appBySlug(node.appSlug);
    const op = opOf(app, node.operation);
    const missingFields = (op?.inputFields ?? []).filter((f) => f.required && !filled(node.config?.[f.key])).map((f) => f.label);
    const issues: string[] = [];
    if (!node.appSlug || !node.operation) issues.push("Choose an app and event.");
    else if (needsAuth(node, app)) issues.push(`Connect ${app?.name ?? node.appSlug}.`);
    for (const label of missingFields) issues.push(`Fill ${label}.`);

    let chapter: StepChapter = "setup";
    if (node.appSlug && node.operation && !needsAuth(node, app)) {
      chapter = missingFields.length ? "configure" : "test";
    }

    return {
      id: node.id,
      index: i + 1,
      type: node.type,
      appSlug: node.appSlug,
      operation: node.operation,
      label: node.label || op?.name || node.operation || node.type,
      connectionId: node.connectionId ?? null,
      chapter,
      missingFields,
      issues,
      protected: true
    };
  });

  const issues = steps.flatMap((s) => s.issues.map((msg) => `Step ${s.index} (${s.label}): ${msg}`));
  const youDoFirst = humanTasksFromSteps(steps);
  const iCan = copilotCapabilities(steps, youDoFirst);
  const suggestions = [...youDoFirst, ...iCan];
  if (!suggestions.length) suggestions.push("Review the draft, run Test workflow, then Publish yourself.");

  return {
    empty: false,
    generic: isStarterDraft(graph),
    nodeCount: graph.nodes.length,
    steps,
    issues,
    suggestions,
    youDoFirst,
    iCan,
    outline: steps.map((s) => `${s.index}. ${s.label} (${s.appSlug || "no app"}) [${s.chapter}]`).join(" → ")
  };
}

const RESOURCE_FIELD = /spreadsheet|worksheet|drive|calendar|channel|event/i;

function humanTasksFromSteps(steps: StepSnapshot[]): string[] {
  const connect: string[] = [];
  const pick: string[] = [];
  const test: string[] = [];
  for (const s of steps) {
    if (s.issues.some((i) => /connect/i.test(i))) {
      connect.push(`Connect ${s.appSlug.replace(/-/g, " ")} on step ${s.index} (${s.label}). I cannot create that account.`);
      continue;
    }
    const picks = s.missingFields.filter((f) => RESOURCE_FIELD.test(f));
    if (picks.length) {
      pick.push(`Choose ${picks.join(", ")} in Configure on step ${s.index}. I will not invent those IDs.`);
    }
    if (s.chapter === "test" && !s.issues.length) {
      test.push(`Test step ${s.index} (${s.label}), then Publish yourself. I cannot publish.`);
    }
  }
  if (connect.length) return connect;
  if (pick.length) return pick;
  if (test.length === steps.length) {
    return [
      `Run Test workflow to execute all ${steps.length} steps in order, review the output, then Publish yourself. I cannot publish.`
    ];
  }
  if (test.length) return [`Test ${test[0].replace(/^Test step \d+ \(([^)]+)\).*/, "$1")}, then continue to the next configured step.`];
  if (steps.length) return ["Review mappings, then click Publish yourself. Copilot cannot turn this workflow on."];
  return [];
}

function copilotCapabilities(steps: StepSnapshot[], youDoFirst: string[]): string[] {
  const blocked = youDoFirst.some((t) => /connect/i.test(t));
  const can: string[] = [];
  if (!blocked && steps.some((s) => s.missingFields.length)) {
    can.push("Map empty text fields from previous steps after Setup is complete.");
  }
  if (steps.length) can.push("Add another action without replacing the nodes you already placed.");
  can.push("Explain a test result or what is left before publish.");
  return can;
}

export function formatCopilotReply(snapshot: DraftSnapshot, extra?: string) {
  if (snapshot.empty) {
    return extra
      ? `The canvas has no steps yet.\n\n${extra}`
      : "The canvas has no steps yet. Describe a trigger and actions, or add them on the canvas.";
  }
  const lines = [
    `Inspected your ${snapshot.nodeCount}-step draft (kept as you built it):`,
    ...snapshot.steps.map((s) => `${s.index}. ${s.label} · ${s.chapter}`)
  ];
  const you = snapshot.youDoFirst?.length ? snapshot.youDoFirst : humanTasksFromSteps(snapshot.steps);
  if (you.length) {
    lines.push("", "Do this first (I cannot):", ...you.map((t) => `• ${t}`));
  }
  const can = snapshot.iCan?.length ? snapshot.iCan : copilotCapabilities(snapshot.steps, you);
  if (can.length) {
    lines.push("", "I can help next:", ...can.map((t) => `• ${t}`));
  }
  if (extra) lines.push("", extra);
  return lines.join("\n");
}

export function describeDraft(snapshot: DraftSnapshot) {
  return formatCopilotReply(snapshot);
}

function quotedName(prompt: string) {
  const m = prompt.match(/step\s+['"]([^'"]+)['"]/i) ?? prompt.match(/['"](\d+\.\s+[^'"]+)['"]/);
  return m?.[1]?.trim() ?? "";
}

export function resolveTargetStep(prompt: string, snapshot: DraftSnapshot, selectedStepId?: string | null) {
  const quoted = quotedName(prompt).toLowerCase();
  if (quoted) {
    const byLabel = snapshot.steps.find((s) => s.label.toLowerCase() === quoted || `${s.index}. ${s.label}`.toLowerCase() === quoted);
    if (byLabel) return byLabel;
    const byPartial = snapshot.steps.find((s) => quoted.includes(s.label.toLowerCase()) || s.label.toLowerCase().includes(quoted));
    if (byPartial) return byPartial;
  }
  const numbered = prompt.match(/\bstep\s*['"]?(\d+)/i) ?? prompt.match(/\b(\d+)\.\s/);
  if (numbered) {
    const idx = Number(numbered[1]);
    const hit = snapshot.steps.find((s) => s.index === idx);
    if (hit) return hit;
  }
  if (/\btrigger\b/i.test(prompt) && !/\baction\b/i.test(prompt)) {
    return snapshot.steps.find((s) => s.type === "trigger") ?? null;
  }
  if (selectedStepId) {
    const selected = snapshot.steps.find((s) => s.id === selectedStepId);
    if (selected) return selected;
  }
  return snapshot.steps.find((s) => s.issues.length) ?? snapshot.steps.at(-1) ?? null;
}

export function isExplicitRebuildPrompt(prompt: string) {
  return /\b(rebuild|start over|from scratch|replace the whole|new workflow from scratch|discard (this|the|my) (draft|workflow|zap))\b/i.test(
    prompt
  );
}

function wantsNextAction(text: string) {
  if (/\b(fill|map|autocomplete|complete the fields)\b/i.test(text)) return false;
  if (/\b(add|insert|append)\b.+\b(step|action|node)\b/i.test(text)) return true;
  if (/\b(next step|another (step|action)|then (add|send|notify|post|create)|also (send|notify|add|create)|after (this|that))\b/i.test(text)) {
    return true;
  }
  return /\b(add|insert|append)\b/i.test(text) && Boolean(mentionedSlug(text));
}

export function classifyCopilotChapter(
  prompt: string,
  snapshot: DraftSnapshot,
  selectedStepId?: string | null
): CopilotChapter {
  const text = prompt.trim();
  if (!text) return snapshot.generic ? "rebuild" : "inspect";
  if (/^(hi|hello|hey|thanks|thank you)[\s!.]*$/i.test(text)) return "inspect";
  if (isExplicitRebuildPrompt(text)) return "rebuild";
  if (/\b(explain|what('s| is) (wrong|left|happening)|status|issues?|suggest|what should i)\b/i.test(text) && !/\b(fill|map|add|build)\b/i.test(text)) {
    return "explain";
  }
  if (/explain the last test/i.test(text)) return "diagnose";
  if (/\b(fill|map|autocomplete|auto-?complete|complete the fields|finish required|customize generation)\b/i.test(text)) {
    return /\b(all|remaining|workflow|every step)\b/i.test(text) ? "autocomplete" : "fill_fields";
  }
  if (!snapshot.generic && !snapshot.empty && /\b(when |whenever )\b/i.test(text) && !/\b(add|insert)\b.+\b(step|action|node)\b/i.test(text)) {
    return "inspect";
  }
  if (wantsNextAction(text) && mentionedSlug(text)) {
    return snapshot.generic ? "rebuild" : "add_step";
  }
  if (
    /\b(add|insert|append)\b.+\b(step|action|node)\b/i.test(text)
  ) {
    return snapshot.generic ? "rebuild" : "add_step";
  }
  // On an empty/generic canvas, any prompt mentioning apps should rebuild
  if (snapshot.generic && mentionedSlug(text)) {
    return "rebuild";
  }
  if (/\b(use|change|switch|replace|set|update|modify|alter)\b/i.test(text) && /\b(trigger|action|step|instead)\b/i.test(text)) {
    return "change_step";
  }
  if (/\b(fix|incomplete|authenticate|connect accounts)\b/i.test(text)) return "autocomplete";
  if (!snapshot.generic && !snapshot.empty) {
    return "inspect";
  }
  if (/\b(build|generate|create|when |whenever )\b/i.test(text)) return "rebuild";
  return snapshot.generic ? "rebuild" : "inspect";
}

function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return JSON.parse(JSON.stringify(graph)) as WorkflowGraph;
}

function tokenFor(predecessors: GraphNode[], fieldKey: string, fieldType: string): string | undefined {
  const trigger = predecessors.find((n) => n.type === "trigger") ?? predecessors[0];
  const tApp = trigger ? appBySlug(trigger.appSlug) : undefined;
  const tOp = tApp ? opOf(tApp, trigger!.operation) : undefined;
  const sampleKeys = tOp?.outputSample ? Object.keys(tOp.outputSample) : [];
  const prefix = trigger?.type === "trigger" || trigger?.id === "trigger" ? "trigger" : `steps.${trigger?.id}`;

  const pick = (names: string[]) => names.find((n) => sampleKeys.includes(n));

  if (/email|from|to|recipient/i.test(fieldKey)) {
    const k = pick(["from", "email", "fromEmail", "sender"]);
    return k ? `{{${prefix}.${k}}}` : undefined;
  }
  if (/subject|summary|title/i.test(fieldKey)) {
    const k = pick(["subject", "summary", "title", "snippet"]);
    return k ? `{{${prefix}.${k}}}` : `{{${prefix}}}`;
  }
  if (/body|text|message|values/i.test(fieldKey)) {
    if (fieldKey === "values" || fieldType === "json") {
      const subj = pick(["subject", "summary"]) ?? "subject";
      const from = pick(["from", "email"]) ?? "from";
      return `["{{${prefix}.${subj}}}","{{${prefix}.${from}}}"]`;
    }
    const k = pick(["snippet", "body", "text", "subject"]);
    return k ? `{{${prefix}.${k}}}` : `{{${prefix}}}`;
  }
  if (/spreadsheet/i.test(fieldKey)) {
    const sheets = [...predecessors].reverse().find((n) => n.appSlug === "google-sheets" && n.config?.spreadsheetId);
    if (sheets?.config?.spreadsheetId) return String(sheets.config.spreadsheetId);
    const created = predecessors.find((n) => n.appSlug === "google-sheets" && n.operation === "create_spreadsheet");
    if (created) return `{{steps.${created.id}.spreadsheetId}}`;
    return undefined;
  }
  if (fieldKey === "sheet") return undefined;
  if (fieldKey === "calendarId") return "primary";
  if (fieldKey === "row") {
    const k = pick(["row"]);
    return k ? `{{${prefix}.${k}}}` : undefined;
  }
  if (fieldKey === "url") return undefined;
  if (sampleKeys.includes(fieldKey)) return `{{${prefix}.${fieldKey}}}`;
  return undefined;
}

function highConfidenceDefault(fieldKey: string, fieldType: string): string | undefined {
  if (fieldKey === "calendarId") return "primary";
  if (fieldKey === "method") return "POST";
  if (fieldKey === "url") return "https://httpbin.org/post";
  if (fieldKey === "timezone") return "UTC";
  if (fieldKey === "cron") return "0 * * * *";
  if (fieldType === "boolean") return undefined;
  return undefined;
}

export function fillEmptyFields(graph: WorkflowGraph, stepId?: string | null): { graph: WorkflowGraph; filledKeys: string[] } {
  const next = cloneGraph(graph);
  const filledKeys: string[] = [];
  const order = next.nodes.map((n) => n.id);
  for (const node of next.nodes) {
    if (stepId && node.id !== stepId) continue;
    const app = appBySlug(node.appSlug);
    const op = opOf(app, node.operation);
    if (!op) continue;
    const preds = next.nodes.filter((n) => order.indexOf(n.id) < order.indexOf(node.id));
    const config = { ...(node.config ?? {}) };
    for (const field of op.inputFields ?? []) {
      if (filled(config[field.key])) continue;
      const mapped = tokenFor(preds, field.key, field.type) ?? (field.required ? highConfidenceDefault(field.key, field.type) : undefined);
      if (mapped === undefined) continue;
      config[field.key] = mapped;
      filledKeys.push(`${node.id}.${field.key}`);
    }
    node.config = config;
  }
  return { graph: next, filledKeys };
}

function placeholderAction(graph: WorkflowGraph) {
  return graph.nodes.find((n) => n.type !== "trigger" && (!n.appSlug || !n.operation));
}

export function appendAction(graph: WorkflowGraph, appSlug: string, operation?: string): WorkflowGraph {
  const next = cloneGraph(graph);
  const app = appBySlug(appSlug);
  if (!app) return next;
  const op =
    (operation ? opOf(app, operation) : undefined) ??
    app.operations.find((o) => o.type !== "trigger") ??
    app.operations[0];
  const hole = placeholderAction(next);
  if (hole) {
    hole.appSlug = app.slug;
    hole.operation = op.key;
    hole.label = op.name;
    hole.config = hole.config ?? {};
    return next;
  }
  const last = next.nodes[next.nodes.length - 1];
  const id = `${app.slug.replace(/[^a-z0-9]/gi, "")}-${op.key}-${next.nodes.length}`;
  next.nodes.push({
    id,
    // appendAction only selects non-trigger operations, so appended nodes are
    // always downstream actions. Keeping this explicit also guards the graph
    // invariant at the type level.
    type: "action",
    appSlug: app.slug,
    operation: op.key,
    label: op.name,
    position: { x: last?.position?.x ?? 280, y: (last?.position?.y ?? 40) + 160 },
    config: {},
    connectionId: null
  });
  if (last) next.edges.push({ id: `e-${last.id}-${id}`, source: last.id, target: id });
  return next;
}

/** Add an editable draft node when a user asks for a node but names no app. */
export function appendBlankAction(graph: WorkflowGraph): WorkflowGraph {
  const next = cloneGraph(graph);
  const existing = placeholderAction(next);
  if (existing) return next;
  const last = next.nodes[next.nodes.length - 1];
  if (!last) return next;
  const id = `action-${next.nodes.length}`;
  next.nodes.push({
    id,
    type: "action",
    appSlug: "",
    operation: "",
    label: "Choose an app and event",
    position: { x: last.position?.x ?? 280, y: (last.position?.y ?? 40) + 160 },
    config: {},
    connectionId: null
  });
  next.edges.push({ id: `e-${last.id}-${id}`, source: last.id, target: id });
  return next;
}

const APP_HINTS: Array<{ re: RegExp; slug: string }> = [
  { re: /\bform\b|\bsubmission\b|\bsubmitted\b|\bintake\b/i, slug: "forms" },
  { re: /gmail|inbox/i, slug: "gmail" },
  { re: /google sheet|spreadsheet|\bsheets\b/i, slug: "google-sheets" },
  { re: /calendar|meeting|event/i, slug: "google-calendar" },
  { re: /google drive|\bdrive\b/i, slug: "google-drive" },
  { re: /slack/i, slug: "slack" },
  { re: /hubspot/i, slug: "hubspot" },
  { re: /salesforce/i, slug: "salesforce" },
  { re: /notion/i, slug: "notion" },
  { re: /airtable/i, slug: "airtable" },
  { re: /github/i, slug: "github" },
  { re: /discord/i, slug: "discord" },
  { re: /telegram/i, slug: "telegram" },
  { re: /whatsapp/i, slug: "whatsapp" },
  { re: /stripe/i, slug: "stripe" },
  { re: /twilio|sms/i, slug: "twilio" },
  { re: /jira/i, slug: "jira" },
  { re: /linear/i, slug: "linear" },
  { re: /trello/i, slug: "trello" },
  { re: /shopify/i, slug: "shopify" },
  { re: /typeform/i, slug: "typeform" },
  { re: /teams|microsoft teams/i, slug: "microsoft-teams" },
  { re: /zendesk/i, slug: "zendesk" },
  { re: /\bopenai\b|chatgpt|\bsummariz(?:e|ing|y)\b|\bllm\b|\bAI\b(?!\s+service)/i, slug: "openai" },
  { re: /anthropic|claude/i, slug: "anthropic" },
  { re: /gemini/i, slug: "gemini" },
  { re: /\bschedule\b|every day|cron|every hour|daily|weekly|monthly/i, slug: "schedule" },
  { re: /http\b/i, slug: "http" },
  { re: /webhook/i, slug: "webhook" },
  { re: /gotomeeting|meeting/i, slug: "gotomeeting" },
  { re: /outlook/i, slug: "outlook" },
  { re: /\brss\b/i, slug: "rss" }
];

function mentionedSlug(prompt: string) {
  return mentionedSlugs(prompt)[0];
}

export function mentionedSlugs(prompt: string) {
  const found: { i: number; slug: string }[] = [];
  for (const h of APP_HINTS) {
    const m = prompt.match(h.re);
    if (m?.index != null) found.push({ i: m.index, slug: h.slug });
  }
  found.sort((a, b) => a.i - b.i);
  return [...new Set(found.map((f) => f.slug))];
}

function applyApp(node: GraphNode, slug: string, asTrigger: boolean) {
  const app = appBySlug(slug);
  if (!app) return node;
  const op = asTrigger
    ? app.operations.find((o) => o.type === "trigger") ?? app.operations[0]
    : app.operations.find((o) => o.type !== "trigger") ?? app.operations[0];
  return {
    ...node,
    appSlug: app.slug,
    operation: op.key,
    label: op.name,
    connectionId: node.appSlug === app.slug ? node.connectionId ?? null : null,
    config: node.appSlug === app.slug ? node.config : {}
  };
}

export function changeTargetStep(graph: WorkflowGraph, stepId: string, prompt: string): WorkflowGraph {
  const next = cloneGraph(graph);
  const slug = mentionedSlug(prompt);
  if (!slug) return next;
  next.nodes = next.nodes.map((n) => (n.id === stepId ? applyApp(n, slug, n.type === "trigger") : n));
  return next;
}

function nodeIds(graph: WorkflowGraph) {
  return graph.nodes.map((n) => `${n.id}:${n.appSlug}:${n.operation}`).join("|");
}

export function orchestrateCopilot(opts: {
  prompt: string;
  graph?: WorkflowGraph | null;
  selectedStepId?: string | null;
  mode?: CopilotMode;
}): {
  chapter: CopilotChapter;
  snapshot: DraftSnapshot;
  graph?: WorkflowGraph;
  rebuilt: boolean;
  changed: boolean;
  reply: string;
  suggestions: string[];
} {
  const snapshot = inspectDraft(opts.graph);
  const chapter = classifyCopilotChapter(opts.prompt, snapshot, opts.selectedStepId);
  const suggestions = snapshot.suggestions;
  const base = opts.graph ? cloneGraph(opts.graph) : { nodes: [], edges: [] };

  if (chapter === "inspect" || chapter === "explain") {
    return { chapter, snapshot, rebuilt: false, changed: false, reply: describeDraft(snapshot), suggestions };
  }

  if (chapter === "diagnose") {
    return {
      chapter,
      snapshot,
      rebuilt: false,
      changed: false,
      reply: `${describeDraft(snapshot)} Ask me after a test run for a failure diagnosis.`,
      suggestions
    };
  }

  if (chapter === "rebuild") {
    return {
      chapter,
      snapshot,
      rebuilt: true,
      changed: true,
      reply: snapshot.generic
        ? "Canvas is a starter draft — I will assemble a new workflow from your description."
        : "You asked to rebuild the whole workflow. Existing nodes will be replaced.",
      suggestions
    };
  }

  if (chapter === "add_step") {
    const slugs = mentionedSlugs(opts.prompt);
    if (!slugs.length) {
      const graph = appendBlankAction(base);
      const changed = nodeIds(graph) !== nodeIds(base);
      const nextSnap = inspectDraft(graph);
      return {
        chapter,
        snapshot: nextSnap,
        graph,
        rebuilt: false,
        changed,
        reply: changed
          ? `${formatCopilotReply(nextSnap)}\n\nI added a blank next step. Select it and choose the app and event you want; I will then help map it.`
          : `${describeDraft(snapshot)} There is already an empty next step. Choose its app and event, then I can configure it.`,
        suggestions: nextSnap.suggestions
      };
    }
    let graph = base;
    const added: string[] = [];
    for (const slug of slugs) {
      const before = nodeIds(graph);
      graph = appendAction(graph, slug);
      if (nodeIds(graph) !== before) added.push(slug);
    }
    const nextSnap = inspectDraft(graph);
    const nextHuman = nextSnap.youDoFirst?.[0];
    return {
      chapter,
      snapshot: nextSnap,
      graph,
      rebuilt: false,
      changed: added.length > 0,
      reply: formatCopilotReply(
        nextSnap,
        added.length
          ? `Added ${added.join(", ")} after your existing steps. Suggested next (you do this): ${nextHuman ?? "Review Configure, then Test, then Publish yourself."}`
          : "Those apps are already on the canvas. Tell me a different next step."
      ),
      suggestions: nextSnap.suggestions
    };
  }

  if (chapter === "change_step") {
    const target = resolveTargetStep(opts.prompt, snapshot, opts.selectedStepId);
    if (!target) {
      return { chapter, snapshot, graph: base, rebuilt: false, changed: false, reply: describeDraft(snapshot), suggestions };
    }
    const graph = changeTargetStep(base, target.id, opts.prompt);
    const others = base.nodes.filter((n) => n.id !== target.id);
    const preserved = others.every((n) => {
      const next = graph.nodes.find((x) => x.id === n.id);
      return next && next.appSlug === n.appSlug && next.operation === n.operation && JSON.stringify(next.config) === JSON.stringify(n.config);
    });
    const nextNode = graph.nodes.find((n) => n.id === target.id);
    return {
      chapter,
      snapshot: inspectDraft(graph),
      graph,
      rebuilt: false,
      changed: true,
      reply: preserved
        ? `Updated step ${target.index} to ${nextNode?.label ?? nextNode?.appSlug} (${nextNode?.appSlug}) in place and left the other nodes you created untouched.`
        : `Updated step ${target.index} to ${nextNode?.label ?? nextNode?.appSlug}.`,
      suggestions: inspectDraft(graph).suggestions
    };
  }

  const target = chapter === "fill_fields" ? resolveTargetStep(opts.prompt, snapshot, opts.selectedStepId) : null;
  if (target?.issues.some((i) => /connect/i.test(i))) {
    return {
      chapter,
      snapshot,
      rebuilt: false,
      changed: false,
      reply: formatCopilotReply(
        snapshot,
        `I cannot fill step ${target.index} until you connect ${target.appSlug.replace(/-/g, " ")}. That sign-in stays yours.`
      ),
      suggestions: snapshot.suggestions
    };
  }
  const filled = fillEmptyFields(base, chapter === "fill_fields" ? target?.id : undefined);
  const nextSnap = inspectDraft(filled.graph);
  return {
    chapter,
    snapshot: nextSnap,
    graph: filled.graph,
    rebuilt: false,
    changed: filled.filledKeys.length > 0,
    reply: filled.filledKeys.length
      ? formatCopilotReply(
          nextSnap,
          `I kept your ${snapshot.nodeCount} existing nodes and filled empty fields${target ? ` on step ${target.index} (${target.label})` : ""}.`
        )
      : formatCopilotReply(
          snapshot,
          "I did not guess remaining values (for example spreadsheet IDs). Pick them in Configure, then I can map the rest from previous steps."
        ),
    suggestions: nextSnap.suggestions
  };
}
