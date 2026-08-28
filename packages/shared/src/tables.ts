// =============================================================================
// Tables — Automation-first database with fields, views, records, automations
// =============================================================================

import { z } from "zod";

// ─── Field Types ─────────────────────────────────────────────────────────────

export const TableFieldType = z.enum([
  "text",
  "long_text",
  "email",
  "phone",
  "number",
  "currency",
  "date",
  "datetime",
  "checkbox",
  "dropdown",
  "multi_select",
  "url",
  "json",
  "formula",
  "ai",
  "linked_record",
  "button",
  "auto_id",
  "created_at",
  "updated_at",
]);
export type TableFieldType = z.infer<typeof TableFieldType>;

export const TableField = z.object({
  id: z.string().uuid(),
  tableId: z.string().uuid(),
  name: z.string().min(1).max(128),
  type: TableFieldType,
  config: z.record(z.unknown()).default({}),
  // For dropdown/multi_select
  options: z.array(z.object({
    label: z.string(),
    value: z.string(),
    color: z.string().optional(),
  })).default([]),
  // For formula fields
  formula: z.string().optional(),
  // For linked_record fields
  linkedTableId: z.string().uuid().optional(),
  // For button fields
  buttonAction: z.enum(["run_workflow", "run_agent", "url", "approval"]).optional(),
  buttonConfig: z.record(z.unknown()).optional(),
  // For AI fields
  aiPrompt: z.string().optional(),
  aiModel: z.string().optional(),
  // Validation
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  // Ordering
  position: z.number().int().default(0),
  visible: z.boolean().default(true),
});
export type TableField = z.infer<typeof TableField>;

// ─── Views ───────────────────────────────────────────────────────────────────

export const ViewType = z.enum(["grid", "kanban", "gallery", "form", "calendar"]);
export type ViewType = z.infer<typeof ViewType>;

export const TableView = z.object({
  id: z.string().uuid(),
  tableId: z.string().uuid(),
  name: z.string().min(1).max(128),
  type: ViewType.default("grid"),
  filters: z.array(z.object({
    fieldId: z.string(),
    operator: z.enum([
      "equals", "not_equals", "contains", "not_contains",
      "starts_with", "ends_with", "gt", "lt", "gte", "lte",
      "is_empty", "is_not_empty", "in", "not_in",
    ]),
    value: z.unknown(),
  })).default([]),
  sorts: z.array(z.object({
    fieldId: z.string(),
    direction: z.enum(["asc", "desc"]),
  })).default([]),
  hiddenFields: z.array(z.string()).default([]),
  groupBy: z.string().optional(),
  // Kanban specific
  kanbanFieldId: z.string().optional(),
  // Calendar specific
  calendarDateFieldId: z.string().optional(),
  calendarEndDateFieldId: z.string().optional(),
  // Permissions
  createdBy: z.string().uuid(),
  isDefault: z.boolean().default(false),
  isPublic: z.boolean().default(false),
});
export type TableView = z.infer<typeof TableView>;

// ─── Records ─────────────────────────────────────────────────────────────────

export const TableRecord = z.object({
  id: z.string().uuid(),
  tableId: z.string().uuid(),
  data: z.record(z.unknown()).default({}),
  createdBy: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TableRecord = z.infer<typeof TableRecord>;

// ─── Table Automations ───────────────────────────────────────────────────────

export const TableAutomation = z.object({
  id: z.string().uuid(),
  tableId: z.string().uuid(),
  name: z.string().min(1).max(256),
  trigger: z.enum(["on_create", "on_update", "on_delete", "button_click", "schedule"]),
  triggerConfig: z.record(z.unknown()).default({}),
  workflowId: z.string().uuid().nullable(),
  agentId: z.string().uuid().nullable(),
  enabled: z.boolean().default(true),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type TableAutomation = z.infer<typeof TableAutomation>;

// ─── Full Table Schema ───────────────────────────────────────────────────────

export const Table = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  name: z.string().min(1).max(256),
  slug: z.string().min(1).max(256),
  description: z.string().max(1000).optional(),
  fields: z.array(TableField).default([]),
  views: z.array(TableView).default([]),
  recordCount: z.number().int().default(0),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Table = z.infer<typeof Table>;
