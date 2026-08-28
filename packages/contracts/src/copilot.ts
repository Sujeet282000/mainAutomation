// =============================================================================
// Copilot Contracts — Request/Response shapes for the copilot API
// =============================================================================

import { z } from "zod";

// ─── Plan Generation ─────────────────────────────────────────────────────────

export const GenerateRequest = z.object({
  prompt: z.string().min(1).max(5000),
  flowId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  mode: z.enum(["auto_build", "ask_as_you_build"]).default("auto_build"),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;

// ─── SSE Event Types ─────────────────────────────────────────────────────────

export const CopilotStageEvent = z.object({
  type: z.literal("stage"),
  stage: z.string(),
  label: z.string(),
});

export const CopilotReasoningEvent = z.object({
  type: z.literal("reasoning"),
  text: z.string(),
});

export const CopilotProposalEvent = z.object({
  type: z.literal("proposal"),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
});

export const CopilotAppliedEvent = z.object({
  type: z.literal("applied"),
  summary: z.string(),
});

export const CopilotTodoEvent = z.object({
  type: z.literal("todo"),
  kind: z.enum(["connect", "fill_field", "confirm", "select_resource", "missing_adapter"]),
  message: z.string(),
  target: z.object({
    stepId: z.string(),
    prop: z.string().optional(),
    piece: z.string().optional(),
  }),
});

export const CopilotDoneEvent = z.object({
  type: z.literal("done"),
  publishable: z.boolean(),
  issues: z.array(z.string()),
});

export const CopilotPlanEvent = z.object({
  type: z.literal("plan"),
  plan: z.record(z.unknown()), // AutomationPlan IR
});

export const CopilotSSEEvent = z.discriminatedUnion("type", [
  CopilotStageEvent,
  CopilotReasoningEvent,
  CopilotProposalEvent,
  CopilotAppliedEvent,
  CopilotTodoEvent,
  CopilotDoneEvent,
  CopilotPlanEvent,
]);
export type CopilotSSEEvent = z.infer<typeof CopilotSSEEvent>;

// ─── Build Request ───────────────────────────────────────────────────────────

export const BuildRequest = z.object({
  plan: z.record(z.unknown()), // AutomationPlan IR (validated on backend)
  projectId: z.string().uuid().optional(),
});
export type BuildRequest = z.infer<typeof BuildRequest>;

export const BuildResponse = z.object({
  ok: z.boolean(),
  flowId: z.string().uuid().optional(),
  graph: z.object({
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
  }).optional(),
  error: z.string().optional(),
  detail: z.string().optional(),
});
export type BuildResponse = z.infer<typeof BuildResponse>;

// ─── Plan & Review Response ──────────────────────────────────────────────────
// This is what the Plan & Review UI consumes.
// Generated from AutomationPlan + connection resolution + validation.

export const PlanReviewStep = z.object({
  id: z.string(),
  order: z.number(),
  label: z.string(),
  description: z.string().optional(),
  appSlug: z.string().nullable(),
  operation: z.string().nullable(),
  appDisplayName: z.string().optional(),
  operationDisplayName: z.string().optional(),
  liveAdapter: z.boolean(),
  confidence: z.number(),
  connectionStatus: z.enum(["connected", "needs_attention", "not_configured", "not_required"]),
  connectionEmail: z.string().optional(),
  needsFields: z.array(z.object({
    field: z.string(),
    label: z.string(),
    type: z.string(),
    required: z.boolean(),
    options: z.array(z.string()).optional(),
  })).optional(),
});
export type PlanReviewStep = z.infer<typeof PlanReviewStep>;

export const PlanReviewResponse = z.object({
  goal: z.string(),
  summary: z.string(),
  confidence: z.number(),
  steps: z.array(PlanReviewStep),
  connections: z.array(z.object({
    appSlug: z.string(),
    appName: z.string(),
    status: z.enum(["connected", "needs_attention", "not_configured"]),
    email: z.string().optional(),
    message: z.string().optional(),
  })),
  attentionItems: z.array(z.object({
    kind: z.string(),
    message: z.string(),
    appSlug: z.string().optional(),
    stepId: z.string().optional(),
    field: z.string().optional(),
    options: z.array(z.string()).optional(),
  })),
  validation: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  publishable: z.boolean(),
});
export type PlanReviewResponse = z.infer<typeof PlanReviewResponse>;
