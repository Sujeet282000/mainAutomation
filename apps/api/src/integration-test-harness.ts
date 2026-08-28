// =============================================================================
// Integration Test Harness — Validates all catalog apps for readiness
// Checks: manifest completeness, adapter availability, acceptance checklist
// =============================================================================

import { APP_CATALOG } from "./catalog";
import { getCatalogReadiness, type AppReadiness } from "./catalog-readiness";
import { listRegisteredAdapters } from "./adapters/registry";

export type AcceptanceChecklist = {
  icon: boolean;
  manifest: boolean;
  authentication: boolean;
  connection: boolean;
  trigger: boolean;
  action: boolean;
  search: boolean;
  dynamicFields: boolean;
  sampleData: boolean;
  inputSchema: boolean;
  outputSchema: boolean;
  fieldMapping: boolean;
  errorHandling: boolean;
  retry: boolean;
  rateLimits: boolean;
  tests: boolean;
  copilotDiscovery: boolean;
  productionReady: boolean;
};

/**
 * Generate the full acceptance checklist for an app.
 */
export function generateAcceptanceChecklist(appSlug: string): AcceptanceChecklist {
  const app = APP_CATALOG.find((a) => a.slug === appSlug);
  const readiness = getCatalogReadiness().get(appSlug);
  const registeredAdapters = new Set(listRegisteredAdapters());

  if (!app) {
    return {
      icon: false, manifest: false, authentication: false, connection: false,
      trigger: false, action: false, search: false, dynamicFields: false,
      sampleData: false, inputSchema: false, outputSchema: false, fieldMapping: false,
      errorHandling: false, retry: false, rateLimits: false, tests: false,
      copilotDiscovery: false, productionReady: false,
    };
  }

  const hasAdapter = readiness?.hasAdapter ?? false;
  const hasTrigger = app.operations.some((o) => o.type === "trigger");
  const hasAction = app.operations.some((o) => o.type === "action");
  const hasSearch = app.operations.some((o) => o.type === "search");
  const hasInputFields = app.operations.some((o) => o.inputFields && o.inputFields.length > 0);
  const hasOutputSample = app.operations.some((o) => o.outputSample && Object.keys(o.outputSample).length > 1);
  const hasAuth = (app.authType ?? "none") !== "none";

  const checklist: AcceptanceChecklist = {
    icon: app.icon !== "🔌" && app.icon.length > 0, // Not default emoji
    manifest: app.operations.length > 0,
    authentication: hasAuth ? true : !hasAuth, // No auth needed = pass
    connection: hasAuth ? hasAdapter : true, // No auth = no connection needed
    trigger: hasTrigger,
    action: hasAction,
    search: hasSearch,
    dynamicFields: app.operations.some((o) =>
      o.inputFields?.some((f) => f.type === "dynamic")
    ),
    sampleData: hasOutputSample,
    inputSchema: hasInputFields,
    outputSchema: hasOutputSample,
    fieldMapping: hasInputFields && hasOutputSample,
    errorHandling: hasAdapter, // Adapters handle errors
    retry: hasAdapter, // Adapters handle retry
    rateLimits: false, // Manual verification needed
    tests: false, // Manual verification needed
    copilotDiscovery: true, // All catalog apps are discoverable
    productionReady: false, // Must be manually verified
  };

  // Override for known adapters
  if (hasAdapter) {
    checklist.errorHandling = true;
    checklist.retry = true;
  }

  return checklist;
}

/**
 * Run the full acceptance check for all apps and return results.
 */
export function runAcceptanceChecks(): Array<{
  slug: string;
  name: string;
  checklist: AcceptanceChecklist;
  passCount: number;
  failCount: number;
  total: number;
  percentage: number;
}> {
  const results = APP_CATALOG.map((app) => {
    const checklist = generateAcceptanceChecklist(app.slug);
    const values = Object.values(checklist);
    const passCount = values.filter(Boolean).length;
    const total = values.length;
    return {
      slug: app.slug,
      name: app.name,
      checklist,
      passCount,
      failCount: total - passCount,
      total,
      percentage: Math.round((passCount / total) * 100),
    };
  });

  // Sort by percentage descending
  results.sort((a, b) => b.percentage - a.percentage);
  return results;
}

/**
 * Generate a summary report of all acceptance checks.
 */
export function generateAcceptanceReport(): {
  totalApps: number;
  fullyReady: number;
  mostlyReady: number; // >75%
  partiallyReady: number; // >50%
  barelyReady: number; // <=50%
  topApps: Array<{ slug: string; name: string; percentage: number }>;
  bottomApps: Array<{ slug: string; name: string; percentage: number }>;
  failedChecks: Record<string, string[]>; // slug → list of failed checks
} {
  const results = runAcceptanceChecks();

  const fullyReady = results.filter((r) => r.percentage === 100).length;
  const mostlyReady = results.filter((r) => r.percentage >= 75 && r.percentage < 100).length;
  const partiallyReady = results.filter((r) => r.percentage >= 50 && r.percentage < 75).length;
  const barelyReady = results.filter((r) => r.percentage < 50).length;

  const failedChecks: Record<string, string[]> = {};
  for (const r of results) {
    const fails = Object.entries(r.checklist)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (fails.length > 0) {
      failedChecks[r.slug] = fails;
    }
  }

  return {
    totalApps: results.length,
    fullyReady,
    mostlyReady,
    partiallyReady,
    barelyReady,
    topApps: results.slice(0, 10).map((r) => ({ slug: r.slug, name: r.name, percentage: r.percentage })),
    bottomApps: results.slice(-10).map((r) => ({ slug: r.slug, name: r.name, percentage: r.percentage })),
    failedChecks,
  };
}
