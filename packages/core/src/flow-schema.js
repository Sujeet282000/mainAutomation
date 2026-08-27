"use strict";
// ============================================================================
// Orchestra Part 5 — Flow Definition Schema (Zod)
// Source of truth: Part 5 § "Flow schemas"
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowDefinition = exports.FlowSettings = exports.TriggerSchema = exports.StepSchema = exports.ConditionSchema = exports.RetryPolicy = exports.PieceRef = exports.StepId = exports.JsonValueSchema = void 0;
exports.containsCredentialMaterial = containsCredentialMaterial;
exports.parseFlowDefinition = parseFlowDefinition;
exports.safeParseFlowDefinition = safeParseFlowDefinition;
exports.definitionHash = definitionHash;
const node_crypto_1 = require("node:crypto");
const zod_1 = require("zod");
exports.JsonValueSchema = zod_1.z.lazy(() => zod_1.z.union([
    zod_1.z.string(),
    zod_1.z.number(),
    zod_1.z.boolean(),
    zod_1.z.null(),
    zod_1.z.array(exports.JsonValueSchema),
    zod_1.z.record(exports.JsonValueSchema),
]));
// ── Step IDs ────────────────────────────────────────────────────────────────
exports.StepId = zod_1.z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/, "Step IDs must be lowercase alphanumeric with underscores, max 64 chars");
// ── Piece reference ─────────────────────────────────────────────────────────
exports.PieceRef = zod_1.z.object({
    name: zod_1.z.string().regex(/^[a-z][a-z0-9_-]*$/),
    version: zod_1.z.string().min(1).default("*"),
});
// ── Retry policy ────────────────────────────────────────────────────────────
exports.RetryPolicy = zod_1.z.object({
    maxAttempts: zod_1.z.number().int().min(1).max(10).default(3),
    backoff: zod_1.z.enum(["fixed", "exponential"]).default("exponential"),
    initialDelayMs: zod_1.z.number().int().min(100).max(300_000).default(1_000),
    maxDelayMs: zod_1.z.number().int().min(100).max(3_600_000).default(60_000),
    retryOn: zod_1.z
        .array(zod_1.z.enum(["transient", "auth", "budget"]))
        .default(["transient"]),
});
exports.ConditionSchema = zod_1.z.lazy(() => zod_1.z.union([
    zod_1.z.object({
        op: zod_1.z.enum(["and", "or"]),
        operands: zod_1.z.array(exports.ConditionSchema).min(2),
    }),
    zod_1.z.object({ op: zod_1.z.literal("not"), operand: exports.ConditionSchema }),
    zod_1.z.object({
        op: zod_1.z.enum([
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
        left: exports.JsonValueSchema,
        right: exports.JsonValueSchema.optional(),
    }),
]));
// ── Base step fields ────────────────────────────────────────────────────────
const BaseStep = zod_1.z.object({
    id: exports.StepId,
    name: zod_1.z.string().min(1).max(160).optional(),
    notes: zod_1.z.string().max(5_000).optional(),
    retry: exports.RetryPolicy.optional(),
    onError: zod_1.z
        .union([zod_1.z.literal("fail"), zod_1.z.literal("continue"), exports.StepId])
        .default("fail"),
});
// ── Piece action step ───────────────────────────────────────────────────────
const PieceActionStep = BaseStep.extend({
    type: zod_1.z.literal("piece_action"),
    piece: exports.PieceRef,
    operation: zod_1.z.string().min(1),
    connectionId: zod_1.z.string().uuid().nullable(),
    props: zod_1.z.record(exports.JsonValueSchema).default({}),
});
// ── HTTP step ───────────────────────────────────────────────────────────────
const HttpStep = BaseStep.extend({
    type: zod_1.z.literal("http"),
    props: zod_1.z.object({
        method: zod_1.z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
        url: zod_1.z.string().min(1),
        headers: zod_1.z.record(zod_1.z.string()).default({}),
        query: zod_1.z.record(zod_1.z.string()).default({}),
        body: exports.JsonValueSchema.optional(),
        timeoutMs: zod_1.z
            .number()
            .int()
            .min(100)
            .max(120_000)
            .default(30_000),
    }),
});
// ── Code step ───────────────────────────────────────────────────────────────
const CodeStep = BaseStep.extend({
    type: zod_1.z.literal("code"),
    props: zod_1.z.object({
        source: zod_1.z.string().min(1).max(100_000),
        inputs: zod_1.z.record(exports.JsonValueSchema).default({}),
        timeoutMs: zod_1.z.number().int().min(100).max(30_000).default(15_000),
    }),
});
// ── AI step ─────────────────────────────────────────────────────────────────
const AiStep = BaseStep.extend({
    type: zod_1.z.literal("ai"),
    props: zod_1.z.object({
        operation: zod_1.z.enum([
            "generate",
            "summarize",
            "classify",
            "extract",
            "embed",
        ]),
        model: zod_1.z.string().default("auto"),
        input: exports.JsonValueSchema,
        responseSchema: zod_1.z.record(exports.JsonValueSchema).optional(),
    }),
});
// ── Agent step ──────────────────────────────────────────────────────────────
const AgentStep = BaseStep.extend({
    type: zod_1.z.literal("agent"),
    props: zod_1.z.object({
        instructions: zod_1.z.string().min(1),
        input: exports.JsonValueSchema,
        tools: zod_1.z
            .array(zod_1.z.object({
            piece: zod_1.z.string(),
            operation: zod_1.z.string(),
            connectionId: zod_1.z.string().uuid().nullable(),
        }))
            .max(20),
        maxIterations: zod_1.z.number().int().min(1).max(25).default(8),
        maxCreditBudget: zod_1.z.number().int().min(1).max(10_000),
    }),
});
// ── Filter step ─────────────────────────────────────────────────────────────
const FilterStep = BaseStep.extend({
    type: zod_1.z.literal("filter"),
    condition: exports.ConditionSchema,
});
// ── Delay step ──────────────────────────────────────────────────────────────
const DelayStep = BaseStep.extend({
    type: zod_1.z.literal("delay"),
    props: zod_1.z
        .object({
        mode: zod_1.z.enum(["duration", "until"]),
        seconds: zod_1.z
            .number()
            .int()
            .min(1)
            .max(31_536_000)
            .optional(),
        untilIso: zod_1.z.string().datetime().optional(),
    })
        .superRefine((value, ctx) => {
        if (value.mode === "duration" && !value.seconds) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: "seconds is required",
            });
        }
        if (value.mode === "until" && !value.untilIso) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: "untilIso is required",
            });
        }
    }),
});
// ── Approval step ───────────────────────────────────────────────────────────
const ApprovalStep = BaseStep.extend({
    type: zod_1.z.literal("approval"),
    props: zod_1.z.object({
        title: zod_1.z.string().min(1),
        assigneeId: zod_1.z.string().uuid().optional(),
        assigneeRole: zod_1.z.string().optional(),
        editableFields: zod_1.z.record(exports.JsonValueSchema).default({}),
        timeoutHours: zod_1.z.number().int().min(1).max(720).default(72),
        onTimeout: zod_1.z.enum(["approve", "reject", "fail"]).default("reject"),
    }),
});
// ── Data table step ─────────────────────────────────────────────────────────
const DataTableStep = BaseStep.extend({
    type: zod_1.z.literal("data_table"),
    props: zod_1.z.object({
        tableId: zod_1.z.string().uuid(),
        operation: zod_1.z.enum(["create", "update", "delete", "get", "find"]),
        data: exports.JsonValueSchema.optional(),
        query: zod_1.z.record(exports.JsonValueSchema).optional(),
    }),
});
// ── Note step ───────────────────────────────────────────────────────────────
const NoteStep = BaseStep.extend({
    type: zod_1.z.literal("note"),
    props: zod_1.z.object({ markdown: zod_1.z.string().min(1).max(20_000) }),
});
// ── Sub-flow step ───────────────────────────────────────────────────────────
const SubFlowStep = BaseStep.extend({
    type: zod_1.z.literal("sub_flow"),
    props: zod_1.z.object({
        flowId: zod_1.z.string().uuid(),
        input: zod_1.z.record(exports.JsonValueSchema).default({}),
        waitForCompletion: zod_1.z.boolean().default(true),
    }),
});
// ── Recursive container steps (lazy to avoid circular refs) ─────────────────
// Branch, Router, and Loop reference the Step union through lazy().
const BranchStepSchema = BaseStep.extend({
    type: zod_1.z.literal("branch"),
    condition: exports.ConditionSchema,
    onTrue: zod_1.z.array(zod_1.z.lazy(() => exports.StepSchema)),
    onFalse: zod_1.z.array(zod_1.z.lazy(() => exports.StepSchema)),
});
const RouterStepSchema = BaseStep.extend({
    type: zod_1.z.literal("router"),
    branches: zod_1.z
        .array(zod_1.z.object({
        id: exports.StepId,
        label: zod_1.z.string().min(1),
        condition: exports.ConditionSchema.optional(),
        default: zod_1.z.boolean().optional(),
        steps: zod_1.z.array(zod_1.z.lazy(() => exports.StepSchema)),
    }))
        .min(1),
});
const LoopStepSchema = BaseStep.extend({
    type: zod_1.z.literal("loop"),
    props: zod_1.z.object({
        items: zod_1.z.string().min(1),
        concurrency: zod_1.z.number().int().min(1).max(20).default(1),
    }),
    steps: zod_1.z.array(zod_1.z.lazy(() => exports.StepSchema)),
});
// ── All steps union (single lazy avoids circular type alias) ────────────────
exports.StepSchema = zod_1.z.lazy(() => zod_1.z.union([
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
]));
// ── Trigger schema ──────────────────────────────────────────────────────────
exports.TriggerSchema = zod_1.z.discriminatedUnion("type", [
    zod_1.z.object({
        id: zod_1.z.literal("trigger"),
        type: zod_1.z.literal("app_event"),
        piece: exports.PieceRef,
        operation: zod_1.z.string().min(1),
        connectionId: zod_1.z.string().uuid().nullable(),
        props: zod_1.z.record(exports.JsonValueSchema).default({}),
        sampleOutput: exports.JsonValueSchema.optional(),
    }),
    zod_1.z.object({
        id: zod_1.z.literal("trigger"),
        type: zod_1.z.literal("schedule"),
        props: zod_1.z.object({
            expression: zod_1.z.string().min(1),
            timezone: zod_1.z.string().default("UTC"),
        }),
    }),
    zod_1.z.object({
        id: zod_1.z.literal("trigger"),
        type: zod_1.z.literal("webhook"),
        props: zod_1.z.object({
            authMode: zod_1.z.enum(["none", "hmac", "bearer"]).default("hmac"),
        }),
    }),
    zod_1.z.object({
        id: zod_1.z.literal("trigger"),
        type: zod_1.z.literal("form"),
        props: zod_1.z.object({
            fields: zod_1.z.array(zod_1.z.record(exports.JsonValueSchema)),
            respondWith: zod_1.z.string().optional(),
        }),
    }),
    zod_1.z.object({
        id: zod_1.z.literal("trigger"),
        type: zod_1.z.literal("manual"),
        props: zod_1.z.record(exports.JsonValueSchema),
    }),
]);
// ── Flow settings ───────────────────────────────────────────────────────────
exports.FlowSettings = zod_1.z.object({
    timezone: zod_1.z.string().default("UTC"),
    concurrency: zod_1.z.number().int().min(1).max(100).default(1),
    errorHandling: zod_1.z
        .object({
        onError: zod_1.z.enum(["fail", "continue"]).default("fail"),
        notify: zod_1.z.boolean().default(true),
        steps: zod_1.z.array(exports.StepSchema).optional(),
    })
        .default({}),
});
// ── Flow definition ─────────────────────────────────────────────────────────
exports.FlowDefinition = zod_1.z.object({
    schemaVersion: zod_1.z.literal(1),
    trigger: exports.TriggerSchema,
    steps: zod_1.z.array(exports.StepSchema).max(200),
    settings: exports.FlowSettings,
});
// ── Utilities ───────────────────────────────────────────────────────────────
const CREDENTIAL_KEY = /^(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|private[_-]?key|secret)$/i;
function containsCredentialMaterial(value) {
    if (Array.isArray(value))
        return value.some(containsCredentialMaterial);
    if (!value || typeof value !== "object")
        return false;
    for (const [key, child] of Object.entries(value)) {
        if (CREDENTIAL_KEY.test(key))
            return true;
        if (containsCredentialMaterial(child))
            return true;
    }
    return false;
}
function parseFlowDefinition(raw) {
    if (containsCredentialMaterial(raw)) {
        throw new Error("Flow definitions must not contain credential material. Use connectionId.");
    }
    return exports.FlowDefinition.parse(raw);
}
function safeParseFlowDefinition(raw) {
    if (containsCredentialMaterial(raw)) {
        return {
            success: false,
            error: { message: "credential_material" },
        };
    }
    return exports.FlowDefinition.safeParse(raw);
}
function definitionHash(def) {
    return (0, node_crypto_1.createHash)("sha256")
        .update(canonicalJson(def))
        .digest("hex");
}
function canonicalJson(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    const rec = value;
    const keys = Object.keys(rec).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
}
