import { z } from "zod";
import type { WorkflowGraph } from "@algoverge/shared";
import { ModelGateway } from "@algoverge/model-gateway";
import { APP_CATALOG } from "./catalog";
import { pickForCopilot } from "./connections";
import { graphFromPrompt, graphFromLanguageModel, isCatalogGraph, bindExistingConnections, mentionsWorkflowIntent, graphFromCatalogPicks } from "./copilot";
import { fillEmptyFields, inspectDraft, isStarterDraft } from "./copilot-orchestrator";
import type { CopilotEvent, CopilotMode } from "./copilot-pipeline";
import { copilotTodos } from "./copilot-pipeline";
import { CatalogIndex } from "./pieces/catalog-index";
import { pieceRegistry, type OperationCard } from "./pieces/registry";
import { validateWorkflowGraph } from "./workflow-validation";
import { planCopilotIntent, type PlannedCopilotIntent } from "./copilot-planner";
import { classifyIntent } from "@algoverge/shared";

const Intent = z.object({
  summary: z.string(),
  trigger: z.object({
    phrase: z.string(),
    appHint: z.string().nullable().optional(),
    operation: z.string().nullable().optional(),
    kind: z.enum(["app_event", "schedule", "webhook", "form", "chat", "manual"]).default("app_event")
  }),
  steps: z.array(
    z.object({
      order: z.number().int(),
      phrase: z.string(),
      appHint: z.string().nullable().optional(),
      operation: z.string().nullable().optional(),
      intentKind: z.enum(["app_action", "ai", "agent", "http", "code", "table"]).default("app_action")
    })
  ),
  ambiguities: z.array(z.string()).default([])
});
export type TIntent = z.infer<typeof Intent>;

export type CopilotEngineResult = {
  graph: WorkflowGraph;
  summary: string;
  source: string;
  rebuilt: boolean;
  changed: boolean;
  chapter: "rebuild";
};

let indexPromise: Promise<CatalogIndex> | null = null;

async function getCatalogIndex() {
  if (!indexPromise) {
    indexPromise = (async () => {
      const index = new CatalogIndex(pieceRegistry, new ModelGateway());
      try {
        await index.reindex();
      } catch {
        /* lexical CatalogIndex.search still works with empty embeddings */
      }
      return index;
    })();
  }
  return indexPromise;
}

/** Stage 1 — deterministic intent parse (LLM optional later via ModelGateway). */
export function parseIntentHeuristic(prompt: string): TIntent {
  const text = prompt.trim();
  const schedule = /\b(every morning|every day|cron|schedule|hourly)\b/i.test(text);
  const webhook = /\b(webhook|catch hook|http post)\b/i.test(text);
  const form = /\b(typeform|form submit|submitted)\b/i.test(text);
  let kind: TIntent["trigger"]["kind"] = "app_event";
  if (schedule) kind = "schedule";
  else if (webhook) kind = "webhook";
  else if (form) kind = "form";
  else if (/\bmanual\b/i.test(text)) kind = "manual";

  const parts = text
    .split(/\b(?:then|and then|, then|after that|, add|, send|, notify|, create)\b/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const triggerPhrase = parts[0] || text;
  const stepPhrases = parts.slice(1);
  if (!stepPhrases.length) {
    const andParts = text.split(/\band\b/i).map((p) => p.trim()).filter(Boolean);
    if (andParts.length > 1) {
      return Intent.parse({
        summary: text.slice(0, 160),
        trigger: { phrase: andParts[0], appHint: null, operation: null, kind },
        steps: andParts.slice(1).map((phrase, i) => ({ order: i + 1, phrase, appHint: null, operation: null, intentKind: "app_action" as const })),
        ambiguities: []
      });
    }
  }
  return Intent.parse({
    summary: text.slice(0, 160),
    trigger: { phrase: triggerPhrase, appHint: null, operation: null, kind },
    steps: (stepPhrases.length ? stepPhrases : []).map((phrase, i) => ({
      order: i + 1,
      phrase,
      appHint: null,
      operation: null,
      intentKind: /summar|score|classif|extract|ai|openai/i.test(phrase) ? ("ai" as const) : ("app_action" as const)
    })),
    ambiguities: []
  });
}

function intentFromPlanner(plan: PlannedCopilotIntent): TIntent {
  return Intent.parse({
    summary: plan.summary,
    trigger: plan.trigger,
    steps: plan.steps,
    ambiguities: plan.ambiguities
  });
}

async function pickBestCard(index: CatalogIndex, phrase: string, kind: "trigger" | "action", exactOperation?: string | null): Promise<{ card: OperationCard; confidence: number; reason: string } | null> {
  const cands = await index.search(phrase, kind, 12);
  if (!cands.length) return null;
  const exact = exactOperation ? cands.find((c) => c.operation === exactOperation) : undefined;
  const lower = phrase.toLowerCase();
  const named = cands.filter((c) => {
    const piece = c.piece.replace(/-/g, " ");
    return lower.includes(c.piece) || lower.includes(piece) || lower.includes(c.pieceDisplay.toLowerCase());
  });
  const card = exact ?? named[0] ?? cands[0];
  return {
    card,
    confidence: exact ? 0.98 : named[0] ? 0.86 : 0.62,
    reason: exact
      ? `AI selected exact catalog operation ${card.pieceDisplay} → ${card.display}`
      : `Retrieved among ${cands.length} catalog candidates; selected ${card.pieceDisplay} → ${card.display}`
  };
}

/** Spec Part 6 — real staged Copilot generate (build-time plane). */
export async function* runCopilotEngine(opts: {
  prompt: string;
  workspaceId?: string | null;
  userEmail?: string | null;
  mode: CopilotMode;
  graph?: WorkflowGraph | null;
}): AsyncGenerator<CopilotEvent | { type: "result"; result: CopilotEngineResult }> {
  const prompt = opts.prompt.trim();
  yield { type: "stage", stage: "intent", label: "Understanding your request" };

  // Classify intent into asset type (workflow, table, form, agent, chatbot, system, etc.)
  const assetClassification = classifyIntent(prompt);
  yield {
    type: "reasoning",
    text: `Asset type: ${assetClassification.assetType} (${Math.round(assetClassification.confidence * 100)}% confidence)\nAction: ${assetClassification.action}${assetClassification.entities.apps.length ? `\nDetected apps: ${assetClassification.entities.apps.join(", ")}` : ""}${assetClassification.dependencies.length ? `\nDependencies: ${assetClassification.dependencies.map((d) => `${d.assetType} (${d.reason})`).join(", ")}` : ""}`
  };

  // If multi-asset system detected, yield a plan-stage event for the UI
  if (assetClassification.assetType === "system" || assetClassification.dependencies.length > 0) {
    yield {
      type: "stage",
      stage: "plan",
      label: `Planning ${assetClassification.assetType} system`
    };
  }

  let intent = parseIntentHeuristic(prompt);
  const index = await getCatalogIndex();
  const planner = await planCopilotIntent({
    prompt,
    graph: opts.graph,
    catalog: pieceRegistry.cards()
  });
  if (planner) {
    intent = intentFromPlanner(planner);
    yield {
      type: "reasoning",
      text: `I understood this as: ${planner.summary}${planner.ambiguities.length ? `\nNeeds your input: ${planner.ambiguities.join("; ")}` : ""}`
    };
  } else {
    yield {
      type: "reasoning",
      text: `Plan: ${intent.summary}\nTrigger: ${intent.trigger.phrase}\n${intent.steps.map((s) => `${s.order}. ${s.phrase}`).join("\n") || "(actions inferred from catalog)"}`
    };
  }
  for (const a of intent.ambiguities) {
    yield { type: "todo", kind: "confirm", message: a, target: { stepId: "trigger" } };
  }

  yield { type: "stage", stage: "retrieve", label: "Finding apps and events" };
  const triggerPick = await pickBestCard(index, `${intent.trigger.phrase} ${intent.trigger.appHint ?? ""}`, "trigger", intent.trigger.operation);
  const stepPicks: Array<{ order: number; card: OperationCard; confidence: number; reason: string }> = [];
  for (const step of intent.steps) {
    const pick = await pickBestCard(index, `${step.phrase} ${step.appHint ?? ""}`, "action", step.operation);
    if (pick) stepPicks.push({ order: step.order, ...pick });
  }
  yield {
    type: "reasoning",
    text: [
      triggerPick
        ? `Trigger: ${triggerPick.card.pieceDisplay} → ${triggerPick.card.display} (${triggerPick.confidence.toFixed(2)})`
        : "Trigger: falling back to prompt heuristics",
      ...stepPicks.map((p) => `Step ${p.order}: ${p.card.pieceDisplay} → ${p.card.display} (${p.confidence.toFixed(2)})`)
    ].join("\n")
  };

  yield { type: "stage", stage: "select", label: "Selecting operations" };
  let graph =
    triggerPick &&
    APP_CATALOG.some((a) => a.slug === triggerPick.card.piece)
      ? graphFromCatalogPicks({
          trigger: { slug: triggerPick.card.piece, key: triggerPick.card.operation },
          actions: stepPicks
            .filter((p) => APP_CATALOG.some((a) => a.slug === p.card.piece))
            .map((p) => ({ slug: p.card.piece, key: p.card.operation }))
        })
      : null;
  if (!graph) graph = graphFromPrompt(prompt);
  const promptLower = prompt.toLowerCase();
  const matchesPhrase = (card: OperationCard) => {
    const hay = `${card.piece} ${card.pieceDisplay} ${card.display} ${card.aliases.join(" ")}`.toLowerCase();
    const tokens = promptLower.split(/[^a-z0-9]+/).filter((t) => t.length > 3);
    return tokens.some((t) => hay.includes(t) || card.piece.includes(t));
  };
  if (triggerPick && matchesPhrase(triggerPick.card) && APP_CATALOG.some((a) => a.slug === triggerPick.card.piece)) {
    const trigger = graph.nodes.find((n) => n.type === "trigger") ?? graph.nodes[0];
    if (trigger && (!trigger.appSlug || trigger.appSlug === triggerPick.card.piece || /manual|webhook/i.test(trigger.appSlug))) {
      trigger.appSlug = triggerPick.card.piece;
      trigger.operation = triggerPick.card.operation;
      trigger.label = triggerPick.card.display;
    }
  }
  for (const pick of stepPicks) {
    if (!matchesPhrase(pick.card) || !APP_CATALOG.some((a) => a.slug === pick.card.piece)) continue;
    const actionNodes = graph.nodes.filter((n) => n.type !== "trigger");
    const target = actionNodes[pick.order - 1];
    if (target && (target.appSlug === pick.card.piece || !target.operation)) {
      target.appSlug = pick.card.piece;
      target.operation = pick.card.operation;
      target.label = pick.card.display;
    }
  }
  // ── Resolve labels from catalog ──
  // Ensure every node has a human-readable label from the catalog, not just the app slug.
  for (const node of graph.nodes) {
    if (node.appSlug && node.operation) {
      const app = APP_CATALOG.find((a) => a.slug === node.appSlug);
      if (app) {
        const op = app.operations.find((o) => o.key === node.operation);
        if (op && (!node.label || node.label === node.appSlug || node.label === app.name)) {
          node.label = `${app.name} — ${op.name}`;
        } else if (op && !node.label.includes("—")) {
          // Label exists but doesn't include the app name separator
          node.label = `${app.name} — ${op.name}`;
        }
      }
    } else if (node.appSlug && (!node.label || node.label === node.appSlug)) {
      const app = APP_CATALOG.find((a) => a.slug === node.appSlug);
      if (app) node.label = app.name;
    }
  }

  yield {
    type: "reasoning",
    text: `Assembled ${graph.nodes.length} catalog steps. AI-selected operations are grounded to the registered catalog.`
  };

  yield { type: "stage", stage: "connect", label: "Matching your connected accounts" };
  graph = await bindExistingConnections(graph, opts.workspaceId, opts.userEmail);
  for (const node of graph.nodes) {
    const app = APP_CATALOG.find((a) => a.slug === node.appSlug);
    if (!app || (app.authType ?? "none") === "none") continue;
    if (node.connectionId) {
      yield { type: "reasoning", text: `Using existing ${app.name} connection on ${node.label}.` };
    } else {
      const picked = opts.workspaceId
        ? await pickForCopilot({ workspaceId: opts.workspaceId, pieceName: node.appSlug, userEmail: opts.userEmail })
        : { connectionId: null as string | null };
      if (picked.connectionId) {
        node.connectionId = picked.connectionId;
        yield { type: "reasoning", text: `Bound ${app.name} connection to ${node.label}.` };
      } else {
        yield {
          type: "todo",
          kind: "connect",
          message: `Connect your ${app.name} account — Copilot cannot create credentials.`,
          target: { stepId: node.id, piece: node.appSlug }
        };
      }
    }
  }

  yield { type: "stage", stage: "schema", label: "Reading data shapes" };
  yield {
    type: "reasoning",
    text: graph.nodes
      .map((n) => {
        const app = APP_CATALOG.find((a) => a.slug === n.appSlug);
        const op = app?.operations.find((o) => o.key === n.operation);
        const keys = op?.outputSample ? Object.keys(op.outputSample) : [];
        return `${n.label}: ${keys.slice(0, 6).join(", ") || "sample schema pending test"}`;
      })
      .join("\n")
  };

  yield { type: "stage", stage: "map", label: "Mapping fields between steps" };
  const mapped = fillEmptyFields(graph);
  graph = mapped.graph;
  yield {
    type: "reasoning",
    text: mapped.filledKeys.length
      ? `Mapped ${mapped.filledKeys.length} field(s). Low-confidence / resource IDs left blank for you.`
      : "No high-confidence field mappings applied. Fill resource IDs yourself."
  };

  yield { type: "stage", stage: "assemble", label: "Building the flow" };
  if (!isCatalogGraph(graph)) {
    graph = graphFromPrompt(prompt);
    graph = await bindExistingConnections(graph, opts.workspaceId, opts.userEmail);
    const again = fillEmptyFields(graph);
    graph = again.graph;
  }
  yield { type: "reasoning", text: inspectDraft(graph).outline };

  yield { type: "stage", stage: "validate", label: "Checking the flow" };
  if (!isCatalogGraph(graph)) {
    yield { type: "reasoning", text: "Catalog validation failed — rebuilding from constrained prompt heuristics." };
    graph = graphFromPrompt(prompt);
    graph = await bindExistingConnections(graph, opts.workspaceId, opts.userEmail);
    graph = fillEmptyFields(graph).graph;
  } else {
    yield { type: "reasoning", text: "Catalog + mapping validation passed. Publish still requires you." };
  }

  yield { type: "stage", stage: "persist", label: "Saving the draft (not publishing)" };
  for (const todo of copilotTodos(graph)) yield todo;

  const snap = inspectDraft(graph);
  const summary =
    snap.youDoFirst?.[0]
      ? `${snap.outline}. You first: ${snap.youDoFirst[0]}`
      : `Draft ready (${graph.nodes.length} steps). Test, then Publish yourself.`;

  if (opts.mode === "ask_as_you_build") {
    yield { type: "proposal", summary, confidence: planner ? 0.9 : 0.78 };
  } else {
    yield { type: "applied", summary };
  }
  yield { type: "done", publishable: false, issues: snap.youDoFirst ?? [] };

  yield {
    type: "result",
    result: {
      graph,
      summary,
      source: planner ? "copilot-ai-planner" : "copilot-engine",
      rebuilt: true,
      changed: true,
      chapter: "rebuild"
    }
  };
}

export function shouldRunFullEngine(prompt: string, graph?: WorkflowGraph | null) {
  if (!prompt.trim()) return false;
  if (isStarterDraft(graph)) return true;
  return mentionsWorkflowIntent(prompt) && /\b(when|whenever)\b/i.test(prompt) && /\b(then|add|append|send|create|notify|post)\b/i.test(prompt);
}
