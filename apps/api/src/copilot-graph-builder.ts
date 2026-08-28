// =============================================================================
// GraphValidator + AtomicBuilder
// Compiles AutomationPlan → WorkflowGraph and persists atomically in DB.
// =============================================================================

import type { AutomationPlan, PlanStep, WorkflowGraph, GraphNode, GraphEdge } from "@algoverge/shared";
import { PlanValidationResult } from "@algoverge/shared";
import { APP_CATALOG } from "./catalog";
import { query, queryOne } from "./db";
import { validateWorkflowGraph } from "./workflow-validation";
import { v4 as uuid } from "uuid";

// ─── Graph Compiler ──────────────────────────────────────────────────────────

/** Compile an AutomationPlan into a WorkflowGraph (React Flow format). */
export function compilePlanToGraph(plan: AutomationPlan): WorkflowGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const step of plan.steps) {
    const isTrigger = step.type === "trigger";
    const position = calculatePosition(step.order, plan.steps.length);

    const node: GraphNode = {
      id: step.id,
      type: isTrigger ? "trigger" : step.type === "condition" ? "logic" : "action",
      appSlug: step.appSlug ?? "",
      operation: step.operation ?? "",
      label: step.label,
      position,
      config: { ...step.config },
      connectionId: step.connectionId ?? null,
    };

    // Apply field mappings to config
    for (const mapping of step.fieldMappings) {
      if (mapping.source) {
        node.config[mapping.destinationField] = `{{${mapping.source.stepId}.${mapping.source.field}}}`;
      } else if (mapping.staticValue !== undefined) {
        node.config[mapping.destinationField] = mapping.staticValue;
      }
    }

    nodes.push(node);

    // Create edges from dependencies
    if (isTrigger) {
      // Trigger has no incoming edges
    } else if (step.dependsOn.length > 0) {
      for (const depId of step.dependsOn) {
        edges.push({
          id: `e-${depId}-${step.id}`,
          source: depId,
          target: step.id,
        });
      }
    } else {
      // Default: connect to previous step
      const prevStep = plan.steps.find((s) => s.order === step.order - 1);
      if (prevStep) {
        edges.push({
          id: `e-${prevStep.id}-${step.id}`,
          source: prevStep.id,
          target: step.id,
        });
      }
    }

    // Handle condition branches
    if (step.condition) {
      // Connect condition true/false branches
      for (const targetId of [...step.condition.trueBranch, ...step.condition.falseBranch]) {
        const existingEdge = edges.find(
          (e) => e.source === step.id && e.target === targetId
        );
        if (!existingEdge) {
          edges.push({
            id: `e-${step.id}-${targetId}`,
            source: step.id,
            target: targetId,
          });
        }
      }
    }
  }

  return { nodes, edges };
}

function calculatePosition(order: number, total: number): { x: number; y: number } {
  return { x: 280, y: 40 + (order - 1) * 180 };
}

// ─── Plan Validator ──────────────────────────────────────────────────────────

/** Validate an AutomationPlan before compilation. */
export function validatePlan(plan: AutomationPlan): typeof PlanValidationResult._type {
  const errors: string[] = [];
  const warnings: string[] = [];
  const attentionItems: typeof import("@algoverge/shared").AttentionItem._type[] = [];

  // Check steps exist
  if (plan.steps.length === 0) {
    errors.push("Plan must have at least one step (a trigger).");
  }

  // Check first step is a trigger
  if (plan.steps.length > 0 && plan.steps[0].type !== "trigger") {
    errors.push("First step must be a trigger.");
  }

  // Validate each step
  for (const step of plan.steps) {
    // Check app+operation are set for app steps
    if (["trigger", "action"].includes(step.type)) {
      if (!step.appSlug) {
        errors.push(`Step "${step.label}" (${step.id}) has no app selected.`);
      } else {
        const app = APP_CATALOG.find((a) => a.slug === step.appSlug);
        if (!app) {
          warnings.push(`Step "${step.label}" uses app "${step.appSlug}" not in catalog.`);
        } else if (!step.liveAdapter) {
          attentionItems.push({
            kind: "missing_adapter",
            message: `${app.name} is in the catalog but doesn't have a live execution adapter yet.`,
            appSlug: step.appSlug,
            stepId: step.id,
          });
        }
      }

      // Check connection is set if required
      if (step.connectionRequired && !step.connectionId) {
        attentionItems.push({
          kind: "connect",
          message: `Step "${step.label}" needs a ${step.appSlug} connection.`,
          appSlug: step.appSlug ?? undefined,
          stepId: step.id,
        });
      }
    }

    // Check dependency references are valid
    for (const depId of step.dependsOn) {
      if (!plan.steps.some((s) => s.id === depId)) {
        errors.push(`Step "${step.label}" depends on non-existent step "${depId}".`);
      }
    }

    // Check condition branches reference valid steps
    if (step.condition) {
      for (const branchId of [...step.condition.trueBranch, ...step.condition.falseBranch]) {
        if (!plan.steps.some((s) => s.id === branchId)) {
          errors.push(`Condition in "${step.label}" references non-existent step "${branchId}".`);
        }
      }
    }
  }

  // Check for cycles
  const visited = new Set<string>();
  const inStack = new Set<string>();
  function hasCycle(stepId: string): boolean {
    if (inStack.has(stepId)) return true;
    if (visited.has(stepId)) return false;
    visited.add(stepId);
    inStack.add(stepId);
    const step = plan.steps.find((s) => s.id === stepId);
    if (step) {
      for (const dep of step.dependsOn) {
        if (hasCycle(dep)) return true;
      }
    }
    inStack.delete(stepId);
    return false;
  }
  for (const step of plan.steps) {
    if (hasCycle(step.id)) {
      errors.push(`Cycle detected involving step "${step.label}".`);
      break;
    }
  }

  // Collect attention items from the plan itself
  attentionItems.push(...plan.attentionItems);

  return {
    valid: errors.length === 0,
    errors,
    warnings: [...warnings, ...plan.warnings],
    attentionItems,
  };
}

// ─── Atomic Builder ──────────────────────────────────────────────────────────

/**
 * Build an AutomationPlan into a persisted workflow atomically.
 * Creates: automation (flow) + version + graph, all in one DB transaction.
 * Returns the automation ID on success.
 */
export async function atomicBuild(opts: {
  plan: AutomationPlan;
  workspaceId: string;
  userId: string;
  projectId: string;
}): Promise<{ flowId: string; graph: WorkflowGraph }> {
  const { plan, workspaceId, userId, projectId } = opts;

  // 1. Validate the plan
  const validation = validatePlan(plan);
  if (!validation.valid) {
    throw new Error(`Plan validation failed: ${validation.errors.join("; ")}`);
  }

  // 2. Compile plan to graph
  const graph = compilePlanToGraph(plan);

  // 3. Validate the compiled graph (non-blocking)
  try {
    const graphResult = await validateWorkflowGraph(graph, { workspaceId, strict: false });
    if (graphResult.issues.length > 0) {
      console.warn("[atomic-build] Graph validation warnings:", graphResult.issues);
    }
  } catch (e) {
    console.warn("[atomic-build] Graph validation skipped:", e);
  }

  // 4. Create the flow (automation) — atomic transaction
  const flowId = uuid();
  const versionId = uuid();
  const now = new Date().toISOString();

  try {
    // Start transaction
    await query("BEGIN");

  // Create the flow — wrap graph in draft_definition with schemaVersion
  const draftDef = { schemaVersion: 1, ...graph };
  await query(
    `INSERT INTO flows (id, org_id, project_id, name, slug, description, status, draft_definition, origin, created_by, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, 'copilot', $8, $9, $10, $11)`,
    [
      flowId,
      workspaceId,
      projectId,
      plan.summary.slice(0, 120),
      `copilot-${flowId.slice(0, 8)}`,
      plan.goal,
      JSON.stringify(draftDef),
      userId,
      userId,
      now,
      now,
    ]
  );

    // Create the version
    const versionDef = { schemaVersion: 1, ...graph };
    const defStr = JSON.stringify(versionDef);
    // Compute a simple hex hash using Node crypto (no PG digest needed)
    const crypto = await import("crypto");
    const defHash = crypto.createHash("sha256").update(defStr).digest("hex");
    await query(
      `INSERT INTO flow_versions (id, org_id, flow_id, version_number, definition, definition_hash, published_by, published_at)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7)`,
      [versionId, workspaceId, flowId, defStr, defHash, userId, now]
    );

    // Commit
    await query("COMMIT");

    console.log(`[atomic-build] Built workflow ${flowId} from plan: ${plan.summary}`);
    return { flowId, graph };
  } catch (err) {
    // Rollback on any error
    await query("ROLLBACK").catch(() => {});
    throw err;
  }
}
