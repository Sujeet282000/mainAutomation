// =============================================================================
// Contracts — Shared Zod schemas between frontend and backend
// These are the single source of truth for API request/response shapes.
// Frontend and backend MUST use these types to prevent drift.
// =============================================================================

export { AutomationPlanSchema, PlanStepSchema, PlanConnectionSchema, AttentionItemSchema } from "./copilot";
export { IntegrationReadinessSchema, AppReadinessSchema, ReadinessStatsSchema } from "./readiness";
export { TestStepRequestSchema, TestStepResultSchema } from "./test-step";
export { ConnectionStateSchema, ConnectionInfoSchema } from "./connection";
