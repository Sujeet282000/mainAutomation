// =============================================================================
// Approvals — First-class runtime primitive for human-in-the-loop
// =============================================================================

import { z } from "zod";

export const ApprovalType = z.enum([
  "simple",           // Approve / Reject
  "data_collection",  // Ask reviewer for information
  "editable",         // Reviewer changes AI-generated data
  "multi_stage",      // Manager → Finance → Admin
]);
export type ApprovalType = z.infer<typeof ApprovalType>;

export const ApprovalRequest = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  // Source
  sourceType: z.enum(["workflow", "agent", "chatbot", "table_button", "manual"]),
  sourceId: z.string().uuid().nullable(),
  sourceStepId: z.string().optional(),
  // Content
  title: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  payload: z.record(z.unknown()).default({}),
  editableFields: z.array(z.object({
    key: z.string(),
    label: z.string(),
    type: z.string(),
    value: z.unknown(),
  })).default([]),
  // Type
  type: ApprovalType.default("simple"),
  // Routing
  assigneeId: z.string().uuid().optional(),
  assigneeRole: z.string().optional(),
  // Timeout
  timeoutHours: z.number().int().default(24),
  timeoutAction: z.enum(["escalate", "auto_approve", "auto_reject", "none"]).default("escalate"),
  // Multi-stage
  stages: z.array(z.object({
    order: z.number().int(),
    assigneeId: z.string().uuid().optional(),
    assigneeRole: z.string().optional(),
    status: z.enum(["pending", "approved", "rejected"]).default("pending"),
    decidedAt: z.string().datetime().optional(),
    comment: z.string().optional(),
  })).default([]),
  // Status
  status: z.enum([
    "pending",
    "approved",
    "rejected",
    "expired",
    "cancelled",
    "awaiting_data",
  ]).default("pending"),
  decision: z.object({
    action: z.enum(["approved", "rejected"]),
    data: z.record(z.unknown()).optional(),
    comment: z.string().optional(),
  }).optional(),
  // Timestamps
  requestedAt: z.string().datetime(),
  decidedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;
