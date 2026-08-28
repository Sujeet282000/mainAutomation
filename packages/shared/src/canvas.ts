// =============================================================================
// Canvas — System visualization with nodes, edges, groups, asset links
// =============================================================================

import { z } from "zod";

export const CanvasNodeType = z.enum([
  "workflow",
  "table",
  "form",
  "interface",
  "agent",
  "chatbot",
  "approval",
  "notification",
  "text",
  "group",
  "note",
  "decision",
  "external",
  "team",
]);
export type CanvasNodeType = z.infer<typeof CanvasNodeType>;

export const CanvasNode = z.object({
  id: z.string().uuid(),
  type: CanvasNodeType,
  label: z.string(),
  // Linked asset
  assetId: z.string().uuid().optional(),
  assetType: z.string().optional(),
  // Position & size
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().default(200),
  height: z.number().default(80),
  // Visual
  color: z.string().optional(),
  icon: z.string().optional(),
  // Content (for text/note nodes)
  content: z.string().optional(),
  // Metadata
  metadata: z.record(z.unknown()).default({}),
});
export type CanvasNode = z.infer<typeof CanvasNode>;

export const CanvasEdge = z.object({
  id: z.string().uuid(),
  source: z.string().uuid(),
  target: z.string().uuid(),
  label: z.string().optional(),
  type: z.enum([
    "triggers",
    "depends_on",
    "sends_data",
    "calls",
    "approves",
    "notifies",
    "reads",
    "writes",
    "default",
  ]).default("default"),
  metadata: z.record(z.unknown()).default({}),
});
export type CanvasEdge = z.infer<typeof CanvasEdge>;

export const CanvasGroup = z.object({
  id: z.string().uuid(),
  label: z.string(),
  nodeIds: z.array(z.string()).default([]),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().default(400),
  height: z.number().default(300),
  color: z.string().optional(),
});
export type CanvasGroup = z.infer<typeof CanvasGroup>;

export const Canvas = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  name: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
  nodes: z.array(CanvasNode).default([]),
  edges: z.array(CanvasEdge).default([]),
  groups: z.array(CanvasGroup).default([]),
  // Viewport
  viewport: z.object({
    x: z.number().default(0),
    y: z.number().default(0),
    zoom: z.number().default(1),
  }).default({}),
  // Sharing
  isPublic: z.boolean().default(false),
  // Metadata
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Canvas = z.infer<typeof Canvas>;
