// ============================================================================
// Orchestra Part 5 — Flow Definition Schema (Zod)
// Source of truth: Part 5 § "Flow schemas"
// ============================================================================

import { createHash } from "node:crypto";
import { z } from "zod";

// ── JSON value type ──────────────────────────────────────────────────────────

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ])
);

// ── Step IDs ────────────────────────────────────────────────────────────────

export const StepId = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,63}$/,
    "Step IDs must be lowercase alphanumeric with underscores, max 64 chars"
  );

// ── Piece reference ─────────────────────────────────────────────────────────

export const PieceRef = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  version: z.string().min(1).default("*"),
});

// ── Retry policy ────────────────────────────────────────────────────────────

export const RetryPolicy = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(3),
  backoff: z.enum(["fixed", "exponential"]).default("exponential"),
  initialDelayMs: z.number().int().min(100).max(300_000).default(1_000),
  maxDelayMs: z.number().int().min(100).max(3_600_000).default(60_000),
  retryOn: z
    .array(z.enum(["transient", "auth", "budget"]))
    .default(["transient"]),
});
export type RetryPolicy = z.infer<typeof RetryPolicy>;

// ── Condition schema ────────────────────────────────────────────────────────

export type Condition =
  | { op: "and" | "or"; operands: Condition[] }
  | { op: "not"; operand: Condition }
  | { op: ConditionOperator; left: JsonValue; right?: JsonValue };

export type ConditionOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "exists"
  | "not_exists"
  | "matches"
  | "in"
  | "not_in"
  | "is_empty"
  | "is_not_empty";

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({
      op: z.enum(["and", "or"]),
      operands: z.array(ConditionSchema).min(2),
    }),
    z.object({ op: z.literal("not"), operand: ConditionSchema }),
    z.object({
      op: z.enum([
        "eq",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "contains",
        "not_contains",
        "starts_with",
        "ends_with",
        "exists",
        "not_exists",
        "matches",
        "in",
        "not_in",
        "is_empty",
        "is_not_empty",
      ]),
      left: JsonValueSchema,
      right: JsonValueSchema.optional(),
    }),
  ])
);

// ── Base step fields ────────────────────────────────────────────────────────

const BaseStep = z.object({
  id: StepId,
  name: z.string().min(1).max(160).optional(),
  notes: z.string().max(5_000).optional(),
  retry: RetryPolicy.optional(),
  onError: z
    .union([z.literal("fail"), z.literal("continue"), StepId])
    .default("fail"),
});

// ── Piece action step ───────────────────────────────────────────────────────

const PieceActionStep = BaseStep.extend({
  type: z.literal("piece_action"),
  piece: PieceRef,
  operation: z.string().min(1),
  connectionId: z.string().uuid().nullable(),
  props: z.record(JsonValueSchema).default({}),
});

// ── HTTP step ───────────────────────────────────────────────────────────────

const HttpStep = BaseStep.extend({
  type: z.literal("http"),
  props: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
    url: z.string().min(1),
    headers: z.record(z.string()).default({}),
    query: z.record(z.string()).default({}),
    body: JsonValueSchema.optional(),
    timeoutMs: z
      .number()
      .int()
      .min(100)
      .max(120_000)
      .default(30_000),
  }),
});

// ── Code step ───────────────────────────────────────────────────────────────

const CodeStep = BaseStep.extend({
  type: z.literal("code"),
  props: z.object({
    source: z.string().min(1).max(100_000),
    inputs: z.record(JsonValueSchema).default({}),
    timeoutMs: z.number().int().min(100).max(30_000).default(15_000),
  }),
});

// ── AI step ─────────────────────────────────────────────────────────────────

const AiStep = BaseStep.extend({
  type: z.literal("ai"),
  props: z.object({
    operation: z.enum([
      "generate",
      "summarize",
      "classify",
      "extract",
      "embed",
    ]),
    model: z.string().default("auto"),
    input: JsonValueSchema,
    responseSchema: z.record(JsonValueSchema).optional(),
  }),
});

// ── Agent step ──────────────────────────────────────────────────────────────

const AgentStep = BaseStep.extend({
  type: z.literal("agent"),
  props: z.object({
    instructions: z.string().min(1),
    input: JsonValueSchema,
    tools: z
      .array(
        z.object({
          piece: z.string(),
          operation: z.string(),
          connectionId: z.string().uuid().nullable(),
        })
      )
      .max(20),
    maxIterations: z.number().int().min(1).max(25).default(8),
    maxCreditBudget: z.number().int().min(1).max(10_000),
  }),
});

// ── Filter step ─────────────────────────────────────────────────────────────

const FilterStep = BaseStep.extend({
  type: z.literal("filter"),
  condition: ConditionSchema,
});

// ── Delay step ──────────────────────────────────────────────────────────────

const DelayStep = BaseStep.extend({
  type: z.literal("delay"),
  props: z
    .object({
      mode: z.enum(["duration", "until"]),
      seconds: z
        .number()
        .int()
        .min(1)
        .max(31_536_000)
        .optional(),
      untilIso: z.string().datetime().optional(),
    })
    .superRefine((value, ctx) => {
      if (value.mode === "duration" && !value.seconds) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "seconds is required",
        });
      }
      if (value.mode === "until" && !value.untilIso) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "untilIso is required",
        });
      }
    }),
});

// ── Approval step ───────────────────────────────────────────────────────────

const ApprovalStep = BaseStep.extend({
  type: z.literal("approval"),
  props: z.object({
    title: z.string().min(1),
    assigneeId: z.string().uuid().optional(),
    assigneeRole: z.string().optional(),
    editableFields: z.record(JsonValueSchema).default({}),
    timeoutHours: z.number().int().min(1).max(720).default(72),
    onTimeout: z.enum(["approve", "reject", "fail"]).default("reject"),
  }),
});

// ── Data table step ─────────────────────────────────────────────────────────

const DataTableStep = BaseStep.extend({
  type: z.literal("data_table"),
  props: z.object({
    tableId: z.string().uuid(),
    operation: z.enum(["create", "update", "delete", "get", "find"]),
    data: JsonValueSchema.optional(),
    query: z.record(JsonValueSchema).optional(),
  }),
});

// ── Note step ───────────────────────────────────────────────────────────────

const NoteStep = BaseStep.extend({
  type: z.literal("note"),
  props: z.object({ markdown: z.string().min(1).max(20_000) }),
});

// ── Sub-flow step ───────────────────────────────────────────────────────────

const SubFlowStep = BaseStep.extend({
  type: z.literal("sub_flow"),
  props: z.object({
    flowId: z.string().uuid(),
    input: z.record(JsonValueSchema).default({}),
    waitForCompletion: z.boolean().default(true),
  }),
});

// ── Recursive container steps (lazy to avoid circular refs) ─────────────────
// Branch, Router, and Loop reference the Step union through lazy().

const BranchStepSchema: z.ZodTypeAny = BaseStep.extend({
  type: z.literal("branch"),
  condition: ConditionSchema,
  onTrue: z.array(z.lazy(() => StepSchema)),
  onFalse: z.array(z.lazy(() => StepSchema)),
});

const RouterStepSchema: z.ZodTypeAny = BaseStep.extend({
  type: z.literal("router"),
  branches: z
    .array(
      z.object({
        id: StepId,
        label: z.string().min(1),
        condition: ConditionSchema.optional(),
        default: z.boolean().optional(),
        steps: z.array(z.lazy(() => StepSchema)),
      })
    )
    .min(1),
});

const LoopStepSchema: z.ZodTypeAny = BaseStep.extend({
  type: z.literal("loop"),
  props: z.object({
    items: z.string().min(1),
    concurrency: z.number().int().min(1).max(20).default(1),
  }),
  steps: z.array(z.lazy(() => StepSchema)),
});

// ── All steps union (single lazy avoids circular type alias) ────────────────

export const StepSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    PieceActionStep,
    HttpStep,
    CodeStep,
    AiStep,
    AgentStep,
    FilterStep,
    DelayStep,
    ApprovalStep,
    DataTableStep,
    NoteStep,
    SubFlowStep,
    BranchStepSchema,
    RouterStepSchema,
    LoopStepSchema,
  ])
);

export type Step = z.infer<typeof StepSchema>;

// ── Trigger schema ──────────────────────────────────────────────────────────

export const TriggerSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.literal("trigger"),
    type: z.literal("app_event"),
    piece: PieceRef,
    operation: z.string().min(1),
    connectionId: z.string().uuid().nullable(),
    props: z.record(JsonValueSchema).default({}),
    sampleOutput: JsonValueSchema.optional(),
  }),
  z.object({
    id: z.literal("trigger"),
    type: z.literal("schedule"),
    props: z.object({
      expression: z.string().min(1),
      timezone: z.string().default("UTC"),
    }),
  }),
  z.object({
    id: z.literal("trigger"),
    type: z.literal("webhook"),
    props: z.object({
      authMode: z.enum(["none", "hmac", "bearer"]).default("hmac"),
    }),
  }),
  z.object({
    id: z.literal("trigger"),
    type: z.literal("form"),
    props: z.object({
      fields: z.array(z.record(JsonValueSchema)),
      respondWith: z.string().optional(),
    }),
  }),
  z.object({
    id: z.literal("trigger"),
    type: z.literal("manual"),
    props: z.record(JsonValueSchema),
  }),
]);

// ── Flow settings ───────────────────────────────────────────────────────────

export const FlowSettings = z.object({
  timezone: z.string().default("UTC"),
  concurrency: z.number().int().min(1).max(100).default(1),
  errorHandling: z
    .object({
      onError: z.enum(["fail", "continue"]).default("fail"),
      notify: z.boolean().default(true),
      steps: z.array(StepSchema).optional(),
    })
    .default({}),
});

// ── Flow definition ─────────────────────────────────────────────────────────

export const FlowDefinition = z.object({
  schemaVersion: z.literal(1),
  trigger: TriggerSchema,
  steps: z.array(StepSchema).max(200),
  settings: FlowSettings,
});

export type TFlowDefinition = z.infer<typeof FlowDefinition>;
export type TTrigger = z.infer<typeof TriggerSchema>;

// ── Utilities ───────────────────────────────────────────────────────────────

const CREDENTIAL_KEY =
  /^(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|private[_-]?key|secret)$/i;

export function containsCredentialMaterial(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCredentialMaterial);
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key)) return true;
    if (containsCredentialMaterial(child)) return true;
  }
  return false;
}

export function parseFlowDefinition(raw: unknown) {
  if (containsCredentialMaterial(raw)) {
    throw new Error(
      "Flow definitions must not contain credential material. Use connectionId."
    );
  }
  return FlowDefinition.parse(raw);
}

export function safeParseFlowDefinition(raw: unknown) {
  if (containsCredentialMaterial(raw)) {
    return {
      success: false as const,
      error: { message: "credential_material" },
    };
  }
  return FlowDefinition.safeParse(raw);
}

export function definitionHash(def: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(def))
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalJson).join(",")}]`;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
}
