// =============================================================================
// Orchestra Part 6 — Expression Engine
// Source of truth: Part 6 § "The expression engine"
//
// Expressions are data mapping, not code execution.
// Tokenization accepts only balanced {{ }} tokens, resolves a bounded path
// over immutable context, and applies a small explicit filter set.
// An unresolved token produces empty string; it never evaluates JavaScript.
// =============================================================================

type Context = Record<string, unknown>;

const TOKEN_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;
const MAX_EXPRESSION_PATH_LENGTH = 512;
const MAX_REGEX_PATTERN_LENGTH = 256;

export class ExpressionError extends Error {
  constructor(
    public readonly code: "UNKNOWN_REFERENCE" | "INVALID_PATH" | "FILTER_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "ExpressionError";
  }
}

/**
 * Resolve all {{ }} expression tokens in a string value.
 * Unresolved tokens produce empty string.
 */
export function interpolate(template: string, context: Context): string {
  return template.replace(TOKEN_PATTERN, (_match, expr: string) => {
    const trimmed = expr.trim();

    // Check for filter syntax: value | filter(arg1, arg2)
    const pipeIndex = trimmed.indexOf("|");
    let path: string;
    let filters: string[] = [];

    if (pipeIndex !== -1) {
      path = trimmed.slice(0, pipeIndex).trim();
      const filterExpr = trimmed.slice(pipeIndex + 1).trim();
      filters = filterExpr
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
    } else {
      path = trimmed;
    }

    // Read the value from context
    let value: unknown;
    try {
      value = readPath(context, path);
    } catch {
      return ""; // Unresolved path → empty string
    }

    // Apply filters
    for (const filterExpr of filters) {
      const [filterName, ...args] = filterExpr
        .split(":")
        .map((a) => a.trim());
      value = applyFilter(filterName, value, args);
    }

    return value === undefined || value === null ? "" : String(value);
  });
}

/**
 * Resolve a single expression token (without interpolation).
 * Returns the raw value from context.
 */
export function resolveExpression(expr: string, context: Context): unknown {
  const trimmed = expr.trim();

  const pipeIndex = trimmed.indexOf("|");
  let path: string;
  let filters: string[] = [];

  if (pipeIndex !== -1) {
    path = trimmed.slice(0, pipeIndex).trim();
    const filterExpr = trimmed.slice(pipeIndex + 1).trim();
    filters = filterExpr
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  } else {
    path = trimmed;
  }

  let value: unknown;
  try {
    value = readPath(context, path);
  } catch {
    return undefined;
  }

  for (const filterExpr of filters) {
    const [filterName, ...args] = filterExpr
      .split(":")
      .map((a) => a.trim());
    value = applyFilter(filterName, value, args);
  }

  return value;
}

/**
 * Resolve a value that may be an expression token or a literal.
 * If the value is a string starting with {{, resolve it.
 * Otherwise return as-is.
 */
export function resolveValue(value: unknown, context: Context): unknown {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
    const expr = trimmed.slice(2, -2).trim();
    return resolveExpression(expr, context);
  }

  // Partial interpolation: string contains tokens mixed with literals
  if (TOKEN_PATTERN.test(value)) {
    TOKEN_PATTERN.lastIndex = 0;
    return interpolate(value, context);
  }

  return value;
}

function readPath(context: Context, path: string): unknown {
  if (path.length > MAX_EXPRESSION_PATH_LENGTH) {
    throw new ExpressionError("INVALID_PATH", `Path exceeds max length: ${path}`);
  }

  // Validate path format: only alphanumeric, dots, underscores, hyphens, brackets
  if (!/^[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*|\[\d+\])*$/u.test(path)) {
    throw new ExpressionError("INVALID_PATH", `Invalid expression path: ${path}`);
  }

  const segments = path.match(/[A-Za-z_][\w-]*|\[\d+\]/g) ?? [];
  return segments.reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    const key = segment.startsWith("[") ? Number(segment.slice(1, -1)) : segment;
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, context);
}

function applyFilter(name: string, value: unknown, args: string[]): unknown {
  switch (name) {
    case "default":
      return empty(value) ? args[0] ?? "" : value;
    case "upper":
      return String(value ?? "").toUpperCase();
    case "lower":
      return String(value ?? "").toLowerCase();
    case "trim":
      return String(value ?? "").trim();
    case "json":
      return JSON.stringify(value);
    case "date":
      return formatDate(value, args[0] ?? "YYYY-MM-DD");
    case "number":
      return Number(value);
    case "replace":
      return String(value ?? "")
        .split(args[0] ?? "")
        .join(args[1] ?? "");
    case "slice":
      return String(value ?? "").slice(
        Number(args[0] ?? 0),
        numberOrUndefined(args[1]),
      );
    case "first":
      return Array.isArray(value) ? value[0] : String(value ?? "").at(0);
    case "last":
      return Array.isArray(value)
        ? value.at(-1)
        : String(value ?? "").at(-1);
    case "length":
      return Array.isArray(value) || typeof value === "string"
        ? value.length
        : 0;
    case "urlencode":
      return encodeURIComponent(String(value ?? ""));
    default:
      throw new ExpressionError("FILTER_ERROR", `Unknown filter: ${name}`);
  }
}

/**
 * Evaluate a condition tree against a context.
 * Used by filter steps and branch/router conditions.
 */
export function evaluateCondition(
  condition: {
    op: string;
    operands?: unknown[];
    operand?: unknown;
    left?: unknown;
    right?: unknown;
  },
  context: Context,
): boolean {
  if (condition.op === "and") {
    return (condition.operands ?? []).every((item) =>
      evaluateCondition(item as any, context),
    );
  }
  if (condition.op === "or") {
    return (condition.operands ?? []).some((item) =>
      evaluateCondition(item as any, context),
    );
  }
  if (condition.op === "not") {
    return !evaluateCondition(condition.operand as any, context);
  }

  const left = resolveValue(condition.left, context);
  const right = resolveValue(condition.right, context);

  switch (condition.op) {
    case "eq":
      return equal(left, right);
    case "neq":
      return !equal(left, right);
    case "gt":
      return Number(left) > Number(right);
    case "gte":
      return Number(left) >= Number(right);
    case "lt":
      return Number(left) < Number(right);
    case "lte":
      return Number(left) <= Number(right);
    case "contains":
      return text(left).includes(text(right));
    case "not_contains":
      return !text(left).includes(text(right));
    case "starts_with":
      return text(left).startsWith(text(right));
    case "ends_with":
      return text(left).endsWith(text(right));
    case "exists":
      return !empty(left);
    case "not_exists":
      return empty(left);
    case "matches": {
      const pattern = String(right ?? "");
      if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
        throw new ExpressionError(
          "FILTER_ERROR",
          `Regex pattern exceeds max length: ${MAX_REGEX_PATTERN_LENGTH}`,
        );
      }
      return new RegExp(pattern, "u").test(String(left ?? ""));
    }
    case "in":
      return Array.isArray(right) && right.some((item) => equal(item, left));
    case "not_in":
      return Array.isArray(right) && !right.some((item) => equal(item, left));
    case "is_empty":
      return empty(left);
    case "is_not_empty":
      return !empty(left);
    default:
      throw new ExpressionError("FILTER_ERROR", `Unknown operator: ${condition.op}`);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function empty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}

function text(value: unknown): string {
  return String(value ?? "");
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined)
    return false;
  if (typeof a === "string" || typeof b === "string")
    return String(a) === String(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

function numberOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function formatDate(value: unknown, format: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (isNaN(date.getTime())) return String(value ?? "");
  // Simple format replacement
  return format
    .replace("YYYY", String(date.getFullYear()))
    .replace("MM", String(date.getMonth() + 1).padStart(2, "0"))
    .replace("DD", String(date.getDate()).padStart(2, "0"))
    .replace("HH", String(date.getHours()).padStart(2, "0"))
    .replace("mm", String(date.getMinutes()).padStart(2, "0"))
    .replace("ss", String(date.getSeconds()).padStart(2, "0"));
}
