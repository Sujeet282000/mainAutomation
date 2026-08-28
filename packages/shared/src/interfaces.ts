// =============================================================================
// Interfaces — Page/app builder with components, data sources, permissions
// =============================================================================

import { z } from "zod";

export const InterfaceComponentType = z.enum([
  "heading",
  "text",
  "button",
  "form",
  "table",
  "kanban",
  "chart",
  "image",
  "file",
  "tabs",
  "divider",
  "html",
  "iframe",
  "search",
  "filter",
  "pagination",
  "record_detail",
  "list",
  "metric",
  "status_badge",
  "avatar",
  "spacer",
]);
export type InterfaceComponentType = z.infer<typeof InterfaceComponentType>;

export const InterfaceComponent = z.object({
  id: z.string().uuid(),
  type: InterfaceComponentType,
  label: z.string().optional(),
  config: z.record(z.unknown()).default({}),
  // Data source binding
  dataSource: z.object({
    type: z.enum(["table", "workflow_output", "static", "api", "variable"]),
    tableId: z.string().uuid().optional(),
    workflowId: z.string().uuid().optional(),
    query: z.record(z.unknown()).optional(),
  }).optional(),
  // Action on click
  action: z.object({
    type: z.enum(["run_workflow", "open_page", "open_url", "submit_form", "none"]),
    workflowId: z.string().uuid().optional(),
    pageId: z.string().uuid().optional(),
    url: z.string().url().optional(),
  }).optional(),
  // Conditional visibility
  conditions: z.array(z.object({
    field: z.string(),
    operator: z.enum(["equals", "not_equals", "contains", "is_empty"]),
    value: z.unknown(),
  })).default([]),
  // Layout
  position: z.number().int().default(0),
  width: z.enum(["full", "half", "third", "quarter"]).default("full"),
  visible: z.boolean().default(true),
});
export type InterfaceComponent = z.infer<typeof InterfaceComponent>;

export const InterfacePage = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  components: z.array(InterfaceComponent).default([]),
  isDefault: z.boolean().default(false),
  requiresAuth: z.boolean().default(false),
  position: z.number().int().default(0),
});
export type InterfacePage = z.infer<typeof InterfacePage>;

export const Interface = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  name: z.string().min(1).max(256),
  slug: z.string().min(1).max(256),
  description: z.string().max(1000).optional(),
  pages: z.array(InterfacePage).default([]),
  // Settings
  settings: z.object({
    theme: z.enum(["light", "dark", "auto"]).default("auto"),
    customCss: z.string().optional(),
    customDomain: z.string().optional(),
    favicon: z.string().optional(),
    logo: z.string().optional(),
  }).default({}),
  // Sharing
  isPublic: z.boolean().default(false),
  publicUrl: z.string().url().optional(),
  requiresAuth: z.boolean().default(false),
  allowedRoles: z.array(z.string()).default([]),
  // Metadata
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Interface = z.infer<typeof Interface>;
