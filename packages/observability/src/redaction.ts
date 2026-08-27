// ============================================================================
// Orchestra Part 12 — Log Redaction
// Source of truth: Part 12 § "Redaction"
// Logs are the most common leak path in a platform that handles other
// people's credentials and other people's customer data.
// ============================================================================

const SENSITIVE_KEYS = new Set([
  // Credentials
  "password",
  "password_hash",
  "secret",
  "api_key",
  "apikey",
  "api_token",
  "access_token",
  "refresh_token",
  "client_secret",
  "private_key",
  "authorization",
  "bearer",
  // Encryption
  "ciphertext",
  "iv",
  "auth_tag",
  "wrapped_dek",
  "encrypted_payload",
  "encrypted_credentials",
  // Service tokens
  "service_token",
  "x_orchestra_service_token",
  "stripe_secret",
  "webhook_secret",
  // Provider keys
  "openai_api_key",
  "anthropic_api_key",
  "gemini_api_key",
]);

const DROP_KEYS = new Set([
  // Payloads — keep length, discard content
  "draft_definition",
  "definition",
  "context",
  "trigger_data",
  "input_json",
  "output_json",
  "payload_json",
  "patch",
]);

/**
 * Redact sensitive fields from a log object.
 * - Sensitive keys: replaced with "[REDACTED]"
 * - Drop keys: replaced with their byte length only
 * - Everything else: kept as-is
 */
export function redactForLog(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactForLog);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lower)) {
      result[key] = "[REDACTED]";
    } else if (DROP_KEYS.has(lower)) {
      result[key] = `[${JSON.stringify(value).length} bytes]`;
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactForLog(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Create a redacted logger wrapper.
 * Every log call goes through redaction before output.
 */
export function createRedactedLogger(logger: any) {
  return {
    info(msg: string, data?: unknown) {
      logger.info(msg, data ? redactForLog(data) : undefined);
    },
    warn(msg: string, data?: unknown) {
      logger.warn(msg, data ? redactForLog(data) : undefined);
    },
    error(msg: string, data?: unknown) {
      logger.error(msg, data ? redactForLog(data) : undefined);
    },
    debug(msg: string, data?: unknown) {
      logger.debug(msg, data ? redactForLog(data) : undefined);
    },
  };
}
