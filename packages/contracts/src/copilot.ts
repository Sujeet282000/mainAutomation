// =============================================================================
// Copilot Contracts — Request/Response shapes for the copilot API
// =============================================================================

import { z } from "zod";

export const GenerateRequest = z.object({
  prompt: z.string().min(1).max(5000),
  flowId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  mode: z.enum(["auto_build", "ask_as_you_build"]).default("auto_build"),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;

// User-safe streaming events. These summarize work without exposing raw model chain-of-thought.
export const CopilotStageEvent = z.object({ type: z.literal("stage"), stage: z.string(), label: z.string() });
export const CopilotReasoningEvent = z.object({ type: z.literal("reasoning"), text: z.string() });
export const CopilotAnalysisEvent = z.object({ type: z.literal("analysis_summary"), title: z.string(), items: z.array(z.string()) });
export const CopilotOperationStartedEvent = z.object({ type: z.literal("operation_started"), operationId: z.string(), kind: z.string(), label: z.string(), detail: z.string().optional() });
export const CopilotOperationCompletedEvent = z.object({ type: z.literal("operation_completed"), operationId: z.string(), kind: z.string(), label: z.string(), success: z.boolean(), detail: z.string().optional() });
export const CopilotConnectionRequiredEvent = z.object({ type: z.literal("connection_required"), stepId: z.string().optional(), appSlug: z.string(), appName: z.string().optional(), message: z.string().optional() });
export const CopilotFieldMappingEvent = z.object({ type: z.literal("field_mapping"), stepId: z.string().optional(), sourceLabel: z.string(), targetLabel: z.string(), mappings: z.array(z.object({ source: z.string(), target: z.string() })) });
export const CopilotTestEvent = z.object({ type: z.literal("test_result"), stepId: z.string().optional(), label: z.string(), success: z.boolean(), fields: z.record(z.unknown()).optional() });
export const CopilotUIAction = z.object({
  type: z.enum(["prompt", "navigate", "connect_account", "choose_app", "choose_action", "select_step", "add_step", "remove_step", "test_step", "test_workflow", "apply_change", "open_form", "open_table", "open_canvas", "open_workflow", "open_agent", "open_chatbot", "open_connection", "retry"]),
  label: z.string(), prompt: z.string().optional(), href: z.string().optional(), appSlug: z.string().optional(), stepId: z.string().optional(), operationId: z.string().optional(),
});
export const CopilotProposalEvent = z.object({ type: z.literal("proposal"), summary: z.string(), confidence: z.number().min(0).max(1) });
export const CopilotAppliedEvent = z.object({ type: z.literal("applied"), summary: z.string() });
export const CopilotTodoEvent = z.object({ type: z.literal("todo"), kind: z.enum(["connect", "fill_field", "confirm", "select_resource", "missing_adapter"]), message: z.string(), target: z.object({ stepId: z.string(), prop: z.string().optional(), piece: z.string().optional() }) });
export const CopilotDoneEvent = z.object({ type: z.literal("done"), publishable: z.boolean(), issues: z.array(z.string()).optional() });
export const CopilotPlanEvent = z.object({ type: z.literal("plan"), plan: z.record(z.unknown()) });

export const CopilotSSEEvent = z.discriminatedUnion("type", [
  CopilotStageEvent, CopilotReasoningEvent, CopilotAnalysisEvent, CopilotOperationStartedEvent, CopilotOperationCompletedEvent,
  CopilotConnectionRequiredEvent, CopilotFieldMappingEvent, CopilotTestEvent, CopilotProposalEvent, CopilotAppliedEvent,
  CopilotTodoEvent, CopilotDoneEvent, CopilotPlanEvent,
]);
export type CopilotSSEEvent = z.infer<typeof CopilotSSEEvent>;

export const BuildRequest = z.object({ plan: z.record(z.unknown()), projectId: z.string().uuid().optional() });
export type BuildRequest = z.infer<typeof BuildRequest>;
export const BuildResponse = z.object({ ok: z.boolean(), flowId: z.string().uuid().optional(), graph: z.object({ nodes: z.array(z.record(z.unknown())), edges: z.array(z.record(z.unknown())) }).optional(), error: z.string().optional(), detail: z.string().optional() });
export type BuildResponse = z.infer<typeof BuildResponse>;

export const PlanReviewStep = z.object({
  id: z.string(), order: z.number(), label: z.string(), description: z.string().optional(), appSlug: z.string().nullable(), operation: z.string().nullable(),
  appDisplayName: z.string().optional(), operationDisplayName: z.string().optional(), liveAdapter: z.boolean(), confidence: z.number(),
  connectionStatus: z.enum(["connected", "needs_attention", "not_configured", "not_required"]), connectionEmail: z.string().optional(),
  needsFields: z.array(z.object({ field: z.string(), label: z.string(), type: z.string(), required: z.boolean(), options: z.array(z.string()).optional() })).optional(),
});
export type PlanReviewStep = z.infer<typeof PlanReviewStep>;
export const PlanReviewResponse = z.object({
  goal: z.string(), summary: z.string(), confidence: z.number(), steps: z.array(PlanReviewStep),
  connections: z.array(z.object({ appSlug: z.string(), appName: z.string(), status: z.enum(["connected", "needs_attention", "not_configured"]), email: z.string().optional(), message: z.string().optional() })),
  attentionItems: z.array(z.object({ kind: z.string(), message: z.string(), appSlug: z.string().optional(), stepId: z.string().optional(), field: z.string().optional(), options: z.array(z.string()).optional() })),
  validation: z.object({ valid: z.boolean(), errors: z.array(z.string()), warnings: z.array(z.string()) }), publishable: z.boolean(),
});
export type PlanReviewResponse = z.infer<typeof PlanReviewResponse>;
