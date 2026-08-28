// =============================================================================
// CopilotPlanBuilder — Enhanced pipeline that produces AutomationPlan IR
// and triggers atomic workflow builds via the GraphBuilder.
// =============================================================================

import type { AutomationPlan, PlanStep, WorkflowGraph } from "@algoverge/shared";
import { AutomationPlan as AutomationPlanSchema } from "@algoverge/shared";
import type { CopilotMode, CopilotEvent } from "./copilot-pipeline";
import { copilotTodos } from "./copilot-pipeline";
import { APP_CATALOG } from "./catalog";
import { planCopilotIntent, type PlannedCopilotIntent } from "./copilot-planner";
import { getCatalogReadiness, hasLiveAdapter } from "./catalog-readiness";
import { resolveConnections } from "./copilot-connection-resolver";
import { buildDataLineage, generateFieldMappings } from "./copilot-field-mapper";
import { validatePlan, compilePlanToGraph, atomicBuild } from "./copilot-graph-builder";
import { inspectDraft, isStarterDraft } from "./copilot-orchestrator";
import { mentionsWorkflowIntent } from "./copilot";
import type { GraphNode } from "@algoverge/shared";
import { queryOne } from "./db";

// ─── Intent-to-Plan Converter ────────────────────────────────────────────────

function intentToPlan(
  intent: PlannedCopilotIntent,
  catalog: Array<{ piece: string; pieceDisplay: string; operation: string; display: string; kind: "trigger" | "action" }>,
  existingGraph?: WorkflowGraph | null
): AutomationPlan {
  const readiness = getCatalogReadiness();
  const steps: PlanStep[] = [];

  // Build trigger step
  const triggerMatch = findBestCatalogMatch(
    intent.trigger.appHint,
    intent.trigger.operation,
    intent.trigger.phrase,
    "trigger",
    catalog,
    readiness
  );

  steps.push({
    id: "trigger",
    type: "trigger",
    label: triggerMatch ? `${triggerMatch.pieceDisplay} — ${triggerMatch.display}` : intent.trigger.phrase,
    description: intent.trigger.phrase,
    order: 1,
    appSlug: triggerMatch?.piece ?? intent.trigger.appHint ?? null,
    operation: triggerMatch?.operation ?? intent.trigger.operation ?? null,
    liveAdapter: triggerMatch ? hasLiveAdapter(triggerMatch.piece, triggerMatch.operation) : false,
    confidence: intent.trigger.operationConfidence || (triggerMatch ? 0.85 : 0.3),
    config: {},
    fieldMappings: [],
    connectionId: null,
    connectionRequired: needsConnection(triggerMatch?.piece ?? null),
    dependsOn: [],
  });

  // Build action steps
  for (const intentStep of intent.steps) {
    const match = findBestCatalogMatch(
      intentStep.appHint,
      intentStep.operation,
      intentStep.phrase,
      "action",
      catalog,
      readiness
    );

    const stepType: PlanStep["type"] =
      intentStep.intentKind === "ai" ? "ai" :
      intentStep.intentKind === "http" ? "http" :
      intentStep.intentKind === "code" ? "code" :
      intentStep.intentKind === "table" ? "action" :
      "action";

    steps.push({
      id: `step_${intentStep.order}`,
      type: stepType,
      label: match ? `${match.pieceDisplay} — ${match.display}` : intentStep.phrase,
      description: intentStep.phrase,
      order: intentStep.order + 1,
      appSlug: match?.piece ?? intentStep.appHint ?? null,
      operation: match?.operation ?? intentStep.operation ?? null,
      liveAdapter: match ? hasLiveAdapter(match.piece, match.operation) : false,
      confidence: intentStep.operationConfidence || (match ? 0.75 : 0.2),
      config: {},
      fieldMappings: [],
      connectionId: null,
      connectionRequired: stepType === "action" && needsConnection(match?.piece ?? null),
      aiPrompt: stepType === "ai" ? intentStep.phrase : undefined,
      dependsOn: [`step_${intentStep.order - 1}`],
    });
  }

  // Handle conditions
  for (const cond of intent.conditions ?? []) {
    steps.push({
      id: `condition_${cond.stepId ?? steps.length}`,
      type: "condition",
      label: cond.description,
      description: cond.description,
      order: steps.length + 1,
      appSlug: null,
      operation: null,
      liveAdapter: false,
      confidence: 0.9,
      config: {},
      fieldMappings: [],
      connectionId: null,
      connectionRequired: false,
      condition: {
        expression: "",
        trueBranch: cond.branches[0]?.stepIds ?? [],
        falseBranch: cond.branches[1]?.stepIds ?? [],
      },
      dependsOn: steps.length > 0 ? [steps[steps.length - 1].id] : [],
    });
  }

  // Determine modification type
  const isModifying = existingGraph && existingGraph.nodes.length > 1 && !isStarterDraft(existingGraph);

  const plan: AutomationPlan = {
    goal: intent.goal ?? intent.summary,
    summary: intent.summary,
    confidence: intent.confidence ?? 0.7,
    steps,
    connections: [],
    attentionItems: [],
    availableData: [],
    warnings: [],
    missingInformation: [],
    modificationType: isModifying ? "modify" : "create",
  };

  return plan;
}

function findBestCatalogMatch(
  appHint: string | null | undefined,
  operation: string | null | undefined,
  phrase: string,
  kind: "trigger" | "action",
  catalog: Array<{ piece: string; pieceDisplay: string; operation: string; display: string; kind: "trigger" | "action" }>,
  readiness: ReturnType<typeof getCatalogReadiness>
): { piece: string; pieceDisplay: string; operation: string; display: string } | null {
  const candidates = catalog.filter((c) => c.kind === kind);

  // 1. Exact operation match
  if (appHint && operation) {
    const exact = candidates.find((c) => c.piece === appHint && c.operation === operation);
    if (exact) return exact;
  }

  // 2. App hint match (prefer live adapters)
  if (appHint) {
    const appMatches = candidates.filter((c) => c.piece === appHint);
    if (appMatches.length > 0) {
      // Prefer one with a live adapter
      const withAdapter = appMatches.find((c) => hasLiveAdapter(c.piece, c.operation));
      return withAdapter ?? appMatches[0];
    }
  }

  // 3. Phrase-based match with readiness ranking
  const phraseLower = phrase.toLowerCase();
  const scored = candidates.map((c) => {
    const hay = `${c.piece} ${c.pieceDisplay} ${c.display}`.toLowerCase();
    let score = 0;
    if (hay.includes(phraseLower)) score += 10;
    const tokens = phraseLower.split(/[^a-z0-9]+/).filter((t) => t.length > 3);
    for (const t of tokens) {
      if (hay.includes(t)) score += 3;
      if (c.piece.includes(t)) score += 2;
    }
    // Boost live adapters
    if (hasLiveAdapter(c.piece, c.operation)) score += 5;
    return { candidate: c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 0 && scored[0].score > 0) return scored[0].candidate;

  return null;
}

function needsConnection(appSlug: string | null): boolean {
  if (!appSlug) return false;
  const app = APP_CATALOG.find((a) => a.slug === appSlug);
  return app ? (app.authType ?? "none") !== "none" : false;
}

// ─── Enhanced Copilot Pipeline ───────────────────────────────────────────────

export type EnhancedCopilotEvent = CopilotEvent | { type: "plan"; plan: AutomationPlan };

/**
 * Run the enhanced copilot pipeline that produces an AutomationPlan IR.
 * This is the new entry point for the copilot.
 */
export async function* runEnhancedCopilot(opts: {
  prompt: string;
  workspaceId: string | null;
  userEmail: string | null;
  mode: CopilotMode;
  graph?: WorkflowGraph | null;
  projectId?: string;
}): AsyncGenerator<EnhancedCopilotEvent> {
  const prompt = opts.prompt.trim();

  // ── Stage 1: Intent ──
  yield { type: "stage", stage: "intent", label: "Understanding your request" };

  const intent = await planCopilotIntent({
    prompt,
    graph: opts.graph,
    catalog: (await import("./pieces/registry")).pieceRegistry.cards(),
  });

  if (!intent) {
    yield { type: "reasoning", text: "Could not parse intent. Try a more specific request." };
    return;
  }

  yield {
    type: "reasoning",
    text: `Goal: ${intent.goal ?? intent.summary}\nTrigger: ${intent.trigger.phrase}\nSteps: ${intent.steps.map((s) => `${s.order}. ${s.phrase}`).join(", ") || "none"}`,
  };

  // ── Stage 2: Build AutomationPlan IR ──
  yield { type: "stage", stage: "plan", label: "Building workflow plan" };

  const plan = intentToPlan(
    intent,
    (await import("./pieces/registry")).pieceRegistry.cards(),
    opts.graph
  );

  yield { type: "plan", plan };
  yield {
    type: "reasoning",
    text: `Plan: ${plan.steps.length} steps (${plan.steps.filter((s) => s.liveAdapter).length} with live adapters)`,
  };

  // ── Stage 3: Resolve Connections ──
  if (opts.workspaceId) {
    yield { type: "stage", stage: "connect", label: "Resolving connections" };
    const connResult = await resolveConnections({
      plan,
      workspaceId: opts.workspaceId,
      userEmail: opts.userEmail,
    });
    plan.connections = connResult.resolved;
    for (const attn of connResult.needsAttention) {
      plan.attentionItems.push({
        kind: "connect",
        message: attn.message,
        appSlug: attn.appSlug,
      });
    }
  }

  // ── Stage 4: Build Data Lineage ──
  yield { type: "stage", stage: "schema", label: "Building data lineage" };
  plan.availableData = buildDataLineage(plan);

  // ── Stage 5: Generate Field Mappings ──
  yield { type: "stage", stage: "map", label: "Mapping fields" };
  for (const step of plan.steps) {
    if (step.type === "action" || step.type === "ai") {
      const prevOutputs = new Map<string, Record<string, unknown>>();
      for (const prevStep of plan.steps.filter((s) => s.order < step.order)) {
        prevOutputs.set(prevStep.id, {});
      }
      step.fieldMappings = generateFieldMappings(step, plan.availableData, prevOutputs);
    }
  }

  // ── Stage 6: Validate ──
  yield { type: "stage", stage: "validate", label: "Validating plan" };
  const validation = validatePlan(plan);
  plan.warnings = validation.warnings;
  plan.attentionItems.push(...validation.attentionItems);

  if (!validation.valid) {
    yield {
      type: "reasoning",
      text: `Plan validation issues: ${validation.errors.join("; ")}`,
    };
  }

  // ── Stage 7: Compile to Graph ──
  yield { type: "stage", stage: "assemble", label: "Compiling workflow graph" };
  let graph = compilePlanToGraph(plan);

  // ── Stage 8: Persist ──
  yield { type: "stage", stage: "persist", label: "Ready to build" };
  for (const todo of copilotTodos(graph)) yield todo;

  const snap = inspectDraft(graph);
  const summary =
    plan.attentionItems.length > 0
      ? `${snap.outline}. Needs your attention: ${plan.attentionItems[0].message}`
      : `Draft ready (${graph.nodes.length} steps). Test, then Publish.`;

  if (opts.mode === "ask_as_you_build") {
    yield { type: "proposal", summary, confidence: plan.confidence };
  } else {
    yield { type: "applied", summary };
  }
  yield { type: "done", publishable: validation.valid && plan.attentionItems.length === 0, issues: plan.attentionItems.map((a) => a.message) };

  // @ts-expect - result is used by the consumer but not in the event union
  yield {
    type: "result" as const,
    result: {
      graph,
      summary,
      source: "copilot-plan-builder",
      rebuilt: true,
      changed: true,
      chapter: "rebuild" as const,
    },
  } as any;
}

/**
 * Build a plan atomically via the backend.
 * Called when the user clicks "Build workflow" in Plan & Review.
 */
export async function buildPlanAtomically(opts: {
  plan: AutomationPlan;
  workspaceId: string;
  userId: string;
  projectId?: string;
}): Promise<{ flowId: string; graph: WorkflowGraph }> {
  // Resolve project if not provided
  let projectId = opts.projectId;
  if (!projectId) {
    const project = await queryOne<{ id: string }>(
      `SELECT id FROM projects WHERE org_id = $1 LIMIT 1`,
      [opts.workspaceId]
    );
    projectId = project?.id;
    if (!projectId) throw new Error("No project found for workspace");
  }

  return atomicBuild({
    plan: opts.plan,
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    projectId,
  });
}
