import type { WorkflowGraph } from "@algoverge/shared";
import { APP_CATALOG } from "../catalog/catalog";

export type CopilotMode = "auto_build" | "ask_as_you_build";

export type CopilotEvent =
  | { type: "stage"; stage: string; label: string }
  | { type: "reasoning"; text: string }
  | { type: "proposal"; summary: string; confidence: number }
  | { type: "applied"; summary: string }
  | {
      type: "todo";
      kind: "connect" | "fill_field" | "confirm";
      message: string;
      target: { stepId: string; prop?: string; piece?: string };
    }
  | { type: "done"; publishable: boolean; issues: string[] };

export const COPILOT_PIPELINE: Array<{ stage: string; label: string }> = [
  { stage: "inspect", label: "Reading the current draft" },
  { stage: "intent", label: "Parsing intent" },
  { stage: "plan", label: "Planning asset system" },
  { stage: "retrieve", label: "Finding apps and events" },
  { stage: "select", label: "Selecting operations" },
  { stage: "connect", label: "Resolving existing connections" },
  { stage: "schema", label: "Hydrating step schemas" },
  { stage: "map", label: "Mapping fields" },
  { stage: "assemble", label: "Assembling the draft graph" },
  { stage: "validate", label: "Validating and repairing" },
  { stage: "persist", label: "Saving the draft (not publishing)" }
];

export function parseCopilotMode(value: unknown): CopilotMode {
  return value === "ask_as_you_build" ? "ask_as_you_build" : "auto_build";
}

export function copilotShouldPersist(mode: CopilotMode) {
  return mode === "auto_build";
}

const SKIP_AUTH = new Set(["webhook", "http", "manual", "schedule", "filter", "paths", "delay", "code", "email"]);

export function copilotTodos(graph: WorkflowGraph): Extract<CopilotEvent, { type: "todo" }>[] {
  const todos: Extract<CopilotEvent, { type: "todo" }>[] = [];
  for (const node of graph.nodes) {
    const app = APP_CATALOG.find((a) => a.slug === node.appSlug);
    const needsAuth = app && (app.authType ?? "none") !== "none" && !SKIP_AUTH.has(node.appSlug);
    if (needsAuth && !node.connectionId) {
      todos.push({
        type: "todo",
        kind: "connect",
        message: `Connect ${app?.name ?? node.appSlug} yourself. Copilot cannot create credentials.`,
        target: { stepId: node.id, piece: node.appSlug }
      });
    }
    const op = app?.operations.find((o) => o.key === node.operation);
    for (const field of op?.inputFields ?? []) {
      if (!field.required) continue;
      const value = node.config?.[field.key];
      if (value === undefined || value === "") {
        todos.push({
          type: "todo",
          kind: "fill_field",
          message: `Fill ${field.label} on ${node.label}. Low-confidence mappings stay blank.`,
          target: { stepId: node.id, prop: field.key, piece: node.appSlug }
        });
      }
    }
  }
  return todos;
}

export function copilotReasoning(prompt: string, graph: WorkflowGraph, mode: CopilotMode) {
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  const actions = graph.nodes.filter((n) => n.type !== "trigger");
  return [
    `Intent: ${prompt.slice(0, 180) || "(empty)"}`,
    `Trigger: ${trigger?.label ?? "unset"} (${trigger?.appSlug ?? "none"}).`,
    `Actions: ${actions.map((n) => `${n.label} (${n.appSlug})`).join(" → ") || "none"}.`,
    "Connection preference: account-email match → most used → any accessible → prompt to connect.",
    `Mode: ${mode === "auto_build" ? "apply draft patches immediately" : "propose patches until you confirm"}.`,
    "Boundaries: Copilot never creates credentials, never stores secrets on the graph, and never publishes."
  ].join(" ");
}

export function copilotPipelineEvents(opts: {
  prompt: string;
  graph: WorkflowGraph;
  mode: CopilotMode;
  summary: string;
  chapter?: string;
}): CopilotEvent[] {
  const inspectOnly = opts.chapter === "inspect" || opts.chapter === "explain" || opts.chapter === "diagnose";
  const stages = inspectOnly
    ? COPILOT_PIPELINE.filter((s) => s.stage === "inspect" || s.stage === "validate")
    : COPILOT_PIPELINE;
  const events: CopilotEvent[] = stages.map((s) => ({ type: "stage", stage: s.stage, label: s.label }));
  events.push({ type: "reasoning", text: copilotReasoning(opts.prompt, opts.graph, opts.mode) });
  events.push(...copilotTodos(opts.graph));
  if (inspectOnly) {
    events.push({ type: "done", publishable: false, issues: copilotTodos(opts.graph).map((t) => t.message) });
    return events;
  }
  if (opts.mode === "ask_as_you_build") {
    events.push({ type: "proposal", summary: opts.summary, confidence: 0.7 });
  } else {
    events.push({ type: "applied", summary: opts.summary });
  }
  const issues = copilotTodos(opts.graph).map((t) => t.message);
  events.push({ type: "done", publishable: false, issues });
  return events;
}
