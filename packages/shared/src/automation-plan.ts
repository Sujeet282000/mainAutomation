// =============================================================================
// AutomationPlan — Canonical Intermediate Representation for Copilot
// The LLM creates this plan. The catalog validates operations. The builder
// compiles it into the existing WorkflowGraph. The LLM never directly mutates
// React Flow nodes.
// =============================================================================

import { z } from "zod";

// ─── Data Lineage ────────────────────────────────────────────────────────────

/** A reference to a data field from a previous step. */
export const DataRef = z.object({
  stepId: z.string().describe("Source step ID (e.g., 'trigger', 'step_2')"),
  field: z.string().describe("Dot-path to the field (e.g., 'from.email', 'subject')"),
  type: z.string().describe("Inferred type: string, number, boolean, object, array"),
  label: z.string().describe("Human-readable label for the field"),
});
export type DataRef = z.infer<typeof DataRef>;

// ─── Field Mapping ───────────────────────────────────────────────────────────

export const FieldMapping = z.object({
  destinationField: z.string().describe("Target field key on the destination operation"),
  source: DataRef.nullable().describe("Source data reference, or null if static/blank"),
  staticValue: z.unknown().optional().describe("Static value when no source ref"),
  confidence: z.number().min(0).max(1).describe("Semantic match confidence"),
  transformation: z.string().optional().describe("Optional transform (e.g., 'upper', 'date_format')"),
});
export type FieldMapping = z.infer<typeof FieldMapping>;

// ─── Plan Step ───────────────────────────────────────────────────────────────

export const PlanStepType = z.enum([
  "trigger",      // App event trigger
  "action",       // App action (Slack send, Sheets append, etc.)
  "ai",           // AI step (classify, summarize, extract, etc.)
  "condition",    // Branch/filter
  "delay",        // Wait
  "code",         // Custom code
  "http",         // Generic HTTP
  "approval",     // Human approval gate
]);
export type PlanStepType = z.infer<typeof PlanStepType>;

export const PlanStep = z.object({
  id: z.string().describe("Stable step identifier (e.g., 'trigger', 'step_2', 'condition_1')"),
  type: PlanStepType,
  label: z.string().describe("Human-readable label"),
  description: z.string().optional().describe("What this step does"),
  order: z.number().int().positive().describe("Execution order (1-based)"),

  // App/operation resolution
  appSlug: z.string().nullable().describe("Catalog app slug, null for ai/condition/delay/code/http"),
  operation: z.string().nullable().describe("Catalog operation key, null when not yet resolved"),
  liveAdapter: z.boolean().describe("Whether a real execution adapter exists for this operation"),
  confidence: z.number().min(0).max(1).describe("How confident we are in the app+operation match"),

  // Input configuration
  config: z.record(z.unknown()).default({}).describe("Static config fields"),
  fieldMappings: z.array(FieldMapping).default([]).describe("Dynamic field mappings from previous steps"),

  // Connection
  connectionId: z.string().nullable().describe("Existing connection ID, null if not connected"),
  connectionRequired: z.boolean().default(false).describe("Whether this step needs an OAuth/API connection"),

  // Conditional logic (for condition steps)
  condition: z.object({
    expression: z.string().describe("Condition expression (e.g., '{{trigger.priority}} === \"high\"')"),
    trueBranch: z.array(z.string()).describe("Step IDs to execute if true"),
    falseBranch: z.array(z.string()).describe("Step IDs to execute if false"),
  }).optional(),

  // AI config
  aiPrompt: z.string().optional().describe("For AI steps: the prompt/instruction"),
  aiModel: z.string().optional().describe("Preferred AI model"),

  // Dependencies
  dependsOn: z.array(z.string()).default([]).describe("Step IDs this step depends on for data"),
});
export type PlanStep = z.infer<typeof PlanStep>;

// ─── Connection Info ─────────────────────────────────────────────────────────

export const PlanConnection = z.object({
  appSlug: z.string(),
  appName: z.string(),
  connectionId: z.string().nullable().describe("Existing connection ID, or null if needs setup"),
  status: z.enum(["connected", "needs_attention", "not_configured"]),
  accountEmail: z.string().optional(),
  message: z.string().optional().describe("Human-readable status message"),
});
export type PlanConnection = z.infer<typeof PlanConnection>;

// ─── Needs Attention ─────────────────────────────────────────────────────────

export const AttentionItem = z.object({
  kind: z.enum(["connect", "select_resource", "fill_field", "confirm", "missing_adapter"]),
  message: z.string(),
  appSlug: z.string().optional(),
  stepId: z.string().optional(),
  field: z.string().optional(),
  options: z.array(z.string()).optional().describe("Possible choices for resource selection"),
});
export type AttentionItem = z.infer<typeof AttentionItem>;

// ─── AutomationPlan IR ───────────────────────────────────────────────────────

export const AutomationPlan = z.object({
  // Meta
  goal: z.string().describe("High-level user objective"),
  summary: z.string().describe("Brief explanation of what the workflow does"),
  confidence: z.number().min(0).max(1).describe("Overall confidence in the plan"),

  // Steps (ordered)
  steps: z.array(PlanStep).min(1).describe("Ordered plan steps, first is always the trigger"),

  // Connections
  connections: z.array(PlanConnection).default([]).describe("All connections needed by this plan"),

  // Attention items (things the user must configure)
  attentionItems: z.array(AttentionItem).default([]).describe("Things that need user input"),

  // Data lineage (for the field mapping engine)
  availableData: z.array(DataRef).default([]).describe("Data available from completed steps"),

  // Warnings
  warnings: z.array(z.string()).default([]).describe("Non-blocking warnings"),

  // Missing information
  missingInformation: z.array(z.string()).default([]).describe("Info needed before the plan can be fully built"),

  // Modification support
  modificationType: z.enum(["create", "modify", "replace"]).default("create").describe("Is this creating new or modifying existing?"),
  targetStepId: z.string().optional().describe("For modifications: which step to modify/replace"),
  insertAfterStepId: z.string().optional().describe("For modifications: insert new step after this one"),
});
export type AutomationPlan = z.infer<typeof AutomationPlan>;

// ─── Validation Result ───────────────────────────────────────────────────────

export const PlanValidationResult = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  attentionItems: z.array(AttentionItem).default([]),
});
export type PlanValidationResult = z.infer<typeof PlanValidationResult>;
