import { getApp } from "./catalog/catalog";

export class StepError extends Error {
  retryable: boolean;
  code: string;
  constructor(message: string, opts?: { retryable?: boolean; code?: string }) {
    super(message);
    this.name = "StepError";
    this.retryable = opts?.retryable ?? true;
    this.code = opts?.code ?? "step_failed";
  }
}

export function isAuthError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /\b(401|403|unauthorized|invalid.?grant|invalid.?token|expired.?token|token.?revoked|reconnect|forbidden)\b/i.test(
    message
  );
}

export function isNonRetryableError(err: unknown) {
  if (err instanceof StepError && !err.retryable) return true;
  return isAuthError(err);
}

export function emptyValue(v: unknown) {
  return v === undefined || v === null || v === "";
}

/** Doc 4 §5: required Piece fields that were mapped but resolved empty fail the step. */
export function missingRequiredMappings(
  appSlug: string,
  operation: string,
  original: Record<string, unknown>,
  resolved: Record<string, unknown>
) {
  const op = getApp(appSlug)?.operations.find((o) => o.key === operation);
  const fields = op?.inputFields ?? [];
  const missing: string[] = [];
  for (const field of fields) {
    if (!field.required) continue;
    const key = field.key;
    const raw = original[key];
    const val = resolved[key];
    const templated = typeof raw === "string" && /\{\{/.test(raw);
    if (emptyValue(val) && (templated || emptyValue(raw))) missing.push(field.label || key);
  }
  return missing;
}

export function shouldPauseAfterFailures(statuses: string[], threshold = 5) {
  const recent = statuses.slice(0, threshold);
  return recent.length >= threshold && recent.every((s) => s === "failed");
}
