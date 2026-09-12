// =============================================================================
// Retry policy — HTTP-status-aware retry classification (P0 #7).
//
// Zero dependencies on purpose: both the legacy engine (runtime-guards) and
// adapters import this module, so it must not create an import cycle.
//
//   401/403            → never retry blindly (auth/permission: reconnect first)
//   404/410            → not retryable (resource is gone)
//   408                → retryable (request timeout)
//   409/425            → retryable (conflict / too early)
//   429                → retryable, respects Retry-After when present
//   5xx                → retryable (provider-side transient failures)
//   everything else 4xx → not retryable (validation-type failures)
// =============================================================================

export type RetryDecision = {
  retryable: boolean;
  code: string;
  /** Milliseconds to wait before the next attempt when the provider says so. */
  retryAfterMs?: number;
};

/** Map an HTTP status (and optional Retry-After header value) to a retry decision. */
export function classifyHttpFailure(status: number, retryAfterHeader?: string | null): RetryDecision {
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  if (status === 429) return { retryable: true, code: "rate_limit", retryAfterMs };
  if (status === 408 || status === 425) return { retryable: true, code: "timeout", retryAfterMs };
  if (status === 409) return { retryable: true, code: "conflict", retryAfterMs };
  if (status === 401 || status === 403) return { retryable: false, code: "auth" };
  if (status === 404 || status === 410) return { retryable: false, code: "not_found" };
  if (status >= 500) return { retryable: true, code: "server_error", retryAfterMs };
  return { retryable: false, code: "client_error" };
}

/** Parse the Retry-After header (seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(value?: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Math.max(0, Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/** Exponential backoff with jitter — used by step retries and queue re-enqueues. */
export function backoffDelayMs(attempt: number, initialDelayMs = 1000, maxDelayMs = 60_000): number {
  const base = Math.min(initialDelayMs * Math.pow(2, Math.max(0, attempt - 1)), maxDelayMs);
  const jitter = Math.random() * 0.25 * base;
  return Math.round(base + jitter);
}
