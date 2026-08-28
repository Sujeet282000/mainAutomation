// =============================================================================
// Agents — Goal-oriented autonomous workers with tools, knowledge, memory
// =============================================================================

import { z } from "zod";

export const AgentToolType = z.enum([
  "gmail_search",
  "gmail_send",
  "sheets_read",
  "sheets_write",
  "slack_send",
  "crm_find",
  "crm_update",
  "workflow_run",
  "table_read",
  "table_write",
  "http_get",
  "http_post",
  "web_search",
  "chatbot_respond",
  "run_workflow",
  "read_table",
  "write_table",
  "create_form",
  "create_interface",
  "request_approval",
  "send_notification",
]);
export type AgentToolType = z.infer<typeof AgentToolType>;

export const AgentTool = z.object({
  id: z.string().uuid(),
  type: AgentToolType,
  name: z.string(),
  config: z.record(z.unknown()).default({}),
  // For workflow_run / read_table / write_table
  targetAssetId: z.string().uuid().optional(),
  // Permissions
  requiresApproval: z.boolean().default(false),
  allowedScopes: z.array(z.string()).default([]),
});
export type AgentTool = z.infer<typeof AgentTool>;

export const Agent = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  name: z.string().min(1).max(256),
  slug: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
  // Core config
  instructions: z.string().max(10000).default(""),
  knowledge: z.string().max(10000).default(""),
  model: z.string().default("openai:gpt-4o-mini"),
  // Tools
  tools: z.array(AgentTool).default([]),
  // Knowledge sources
  knowledgeSourceIds: z.array(z.string().uuid()).default([]),
  // Triggers
  triggers: z.array(z.object({
    type: z.enum(["manual", "webhook", "schedule", "table_event", "form_submission"]),
    config: z.record(z.unknown()).default({}),
  })).default([]),
  // Limits
  maxActions: z.number().int().default(8),
  maxTokens: z.number().int().default(4096),
  timeoutSeconds: z.number().int().default(300),
  // Approvals
  approvalRequired: z.boolean().default(false),
  approvalThreshold: z.number().optional(),
  // Memory
  memoryEnabled: z.boolean().default(false),
  memoryMaxMessages: z.number().int().default(50),
  // Status
  status: z.enum(["active", "paused", "disabled"]).default("active"),
  lastRunAt: z.string().datetime().optional(),
  totalRuns: z.number().int().default(0),
  // Metadata
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Agent = z.infer<typeof Agent>;

// ─── Agent Run ───────────────────────────────────────────────────────────────

export const AgentRun = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  orgId: z.string().uuid(),
  status: z.enum(["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled"]),
  input: z.record(z.unknown()).default({}),
  output: z.record(z.unknown()).default({}),
  steps: z.array(z.object({
    type: z.string(),
    tool: z.string().optional(),
    input: z.record(z.unknown()).optional(),
    output: z.record(z.unknown()).optional(),
    tokens: z.number().optional(),
    costUsd: z.number().optional(),
    timestamp: z.string().datetime(),
  })).default([]),
  tokensIn: z.number().int().default(0),
  tokensOut: z.number().int().default(0),
  costUsd: z.number().default(0),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  error: z.string().optional(),
});
export type AgentRun = z.infer<typeof AgentRun>;
