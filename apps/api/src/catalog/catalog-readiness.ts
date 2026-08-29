// =============================================================================
// Catalog Readiness — Tracks production readiness of each integration
// Checks: manifest, adapter, OAuth config, connections, tests
// =============================================================================

import { APP_CATALOG } from "./catalog";
import { listRegisteredAdapters } from "../adapters/registry";

export type ReadinessStatus =
  | "catalog_only"      // Only in the catalog manifest
  | "manifested"        // Has full manifest with operations
  | "adapter_ready"     // Has a real execution adapter
  | "production_ready"; // Adapter + tested

export type AppReadiness = {
  slug: string;
  name: string;
  category: string;
  hasManifest: boolean;
  operationCount: number;
  hasAdapter: boolean;
  adapterOperations: string[];
  authType: string;
  status: ReadinessStatus;
};

let readinessCache: Map<string, AppReadiness> | null = null;

/**
 * Check the readiness status of all catalog apps.
 * Results are cached for the lifetime of the process.
 */
export function getCatalogReadiness(): Map<string, AppReadiness> {
  if (readinessCache) return readinessCache;

  const registeredAdapters = new Set(listRegisteredAdapters());
  const readiness = new Map<string, AppReadiness>();

  for (const app of APP_CATALOG) {
    const adapterOps: string[] = [];
    for (const op of app.operations) {
      if (registeredAdapters.has(`${app.slug}:${op.key}`) || registeredAdapters.has(`${app.slug}:*`)) {
        adapterOps.push(op.key);
      }
    }

    const hasAdapter = adapterOps.length > 0;
    const hasAuth = (app.authType ?? "none") !== "none";
    const hasManifest = app.operations.length > 0;

    let status: ReadinessStatus = "catalog_only";
    if (hasManifest && hasAdapter) status = "adapter_ready";
    if (hasManifest && !hasAdapter) status = "manifested";

    readiness.set(app.slug, {
      slug: app.slug,
      name: app.name,
      category: app.category,
      hasManifest,
      operationCount: app.operations.length,
      hasAdapter,
      adapterOperations: adapterOps,
      authType: app.authType ?? "none",
      status,
    });
  }

  readinessCache = readiness;
  return readiness;
}

/**
 * Check if a specific app+operation has a live adapter.
 */
export function hasLiveAdapter(appSlug: string, operation: string): boolean {
  const readiness = getCatalogReadiness();
  const app = readiness.get(appSlug);
  if (!app) return false;
  return app.adapterOperations.includes(operation) || app.hasAdapter;
}

/**
 * Get summary stats.
 */
export function getReadinessStats() {
  const readiness = getCatalogReadiness();
  const apps = [...readiness.values()];
  return {
    total: apps.length,
    productionReady: apps.filter((a) => a.status === "production_ready").length,
    adapterReady: apps.filter((a) => a.status === "adapter_ready").length,
    manifested: apps.filter((a) => a.status === "manifested").length,
    catalogOnly: apps.filter((a) => a.status === "catalog_only").length,
    withAdapter: apps.filter((a) => a.hasAdapter).length,
  };
}
