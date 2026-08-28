// =============================================================================
// Integration Readiness Contracts — What the UI consumes for app status
// =============================================================================

import { z } from "zod";

export const ReadinessStatus = z.enum([
  "catalog_only",
  "manifested",
  "adapter_ready",
  "production_ready",
]);
export type ReadinessStatus = z.infer<typeof ReadinessStatus>;

export const AppReadiness = z.object({
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  hasManifest: z.boolean(),
  operationCount: z.number(),
  hasAdapter: z.boolean(),
  adapterOperations: z.array(z.string()),
  authType: z.string(),
  status: ReadinessStatus,
  // Extended acceptance checklist
  acceptance: z.object({
    icon: z.boolean(),
    manifest: z.boolean(),
    authentication: z.boolean(),
    connection: z.boolean(),
    trigger: z.boolean(),
    action: z.boolean(),
    search: z.boolean(),
    dynamicFields: z.boolean(),
    sampleData: z.boolean(),
    inputSchema: z.boolean(),
    outputSchema: z.boolean(),
    fieldMapping: z.boolean(),
    errorHandling: z.boolean(),
    retry: z.boolean(),
    rateLimits: z.boolean(),
    tests: z.boolean(),
    copilotDiscovery: z.boolean(),
    productionReady: z.boolean(),
  }).optional(),
});
export type AppReadiness = z.infer<typeof AppReadiness>;

export const ReadinessStats = z.object({
  total: z.number(),
  productionReady: z.number(),
  adapterReady: z.number(),
  manifested: z.number(),
  catalogOnly: z.number(),
  withAdapter: z.number(),
});
export type ReadinessStats = z.infer<typeof ReadinessStats>;

export const IntegrationReadinessResponse = z.object({
  stats: ReadinessStats,
  apps: z.array(AppReadiness),
});
export type IntegrationReadinessResponse = z.infer<typeof IntegrationReadinessResponse>;
