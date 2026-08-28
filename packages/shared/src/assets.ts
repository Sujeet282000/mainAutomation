// =============================================================================
// Asset Registry — Unified asset model for all product surfaces
// Every product (workflow, table, form, interface, canvas, agent, chatbot)
// is an asset in a single tenant-aware registry.
// =============================================================================

import { z } from "zod";

// ─── Asset Types ─────────────────────────────────────────────────────────────

export const AssetType = z.enum([
  "workflow",
  "table",
  "form",
  "interface",
  "canvas",
  "agent",
  "chatbot",
]);
export type AssetType = z.infer<typeof AssetType>;

export const AssetStatus = z.enum([
  "draft",
  "active",
  "paused",
  "disabled",
  "archived",
]);
export type AssetStatus = z.infer<typeof AssetStatus>;

// ─── Asset Record ────────────────────────────────────────────────────────────

export const Asset = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  type: AssetType,
  name: z.string().min(1).max(256),
  slug: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
  status: AssetStatus.default("draft"),
  folderId: z.string().uuid().optional(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Asset = z.infer<typeof Asset>;

// ─── Asset Relationships ─────────────────────────────────────────────────────

export const AssetRelation = z.object({
  id: z.string().uuid(),
  sourceAssetId: z.string().uuid(),
  targetAssetId: z.string().uuid(),
  relationType: z.enum([
    "triggers",        // Form triggers Workflow
    "depends_on",      // Workflow depends on Table
    "calls",           // Workflow calls Sub-workflow
    "reads_from",      // Agent reads Table
    "writes_to",       // Workflow writes Table
    "embeds",          // Interface embeds Form
    "contains",        // Canvas contains Workflow
    "notifies",        // Workflow notifies Chatbot
    "approves",        // Workflow requires Approval
    "uses",            // Agent uses Knowledge
    "generates",       // AI generates Record
  ]),
  metadata: z.record(z.unknown()).default({}),
});
export type AssetRelation = z.infer<typeof AssetRelation>;

// ─── Asset Graph ─────────────────────────────────────────────────────────────

export const AssetGraph = z.object({
  nodes: z.array(z.object({
    id: z.string().uuid(),
    type: AssetType,
    name: z.string(),
    status: AssetStatus,
    x: z.number().default(0),
    y: z.number().default(0),
  })),
  edges: z.array(z.object({
    id: z.string().uuid(),
    source: z.string().uuid(),
    target: z.string().uuid(),
    relationType: AssetRelation.shape.relationType,
  })),
});
export type AssetGraph = z.infer<typeof AssetGraph>;

// ─── Folder ──────────────────────────────────────────────────────────────────

export const Folder = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1).max(128),
  parentId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type Folder = z.infer<typeof Folder>;

// ─── Shared Knowledge ────────────────────────────────────────────────────────

export const KnowledgeSource = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1).max(256),
  type: z.enum(["file", "url", "table", "document", "text"]),
  content: z.string().optional(),
  url: z.string().url().optional(),
  tableId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
});
export type KnowledgeSource = z.infer<typeof KnowledgeSource>;
