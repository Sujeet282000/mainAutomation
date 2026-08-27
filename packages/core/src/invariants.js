"use strict";
// ============================================================================
// Orchestra Part 3 — Architectural Invariants (enforced in code)
// Source of truth: Part 3 § "The nine architectural invariantز"
// These hold system-wide. Every later part is checked against them.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.COPilot_CAPABILITIES = exports.INVARIANT_9_AI_ATTRIBUTION = exports.INVARIANT_8_IMMUTABLE_VERSIONS = exports.INVARIANT_7_DUAL_TENANT_ISOLATION = exports.INVARIANT_6_TOOL_EXECUTION_IN_NODE = exports.INVARIANT_5_AI_ADVISORY = exports.INVARIANT_4_IDEMPOTENT_SIDE_EFFECTS = exports.INVARIANT_3_APPEND_ONLY_CONTEXT = exports.INVARIANT_2_CREDENTIAL_ISOLATION = exports.INVARIANT_1_RUN_PINNING = void 0;
exports.assertCapability = assertCapability;
/**
 * INVARIANT 1: A run pins exactly one immutable flow version.
 * Editing a draft can never alter an in-flight execution.
 * Enforced by: flow_runs.flow_version_id FK, flow_versions.immutable trigger
 */
exports.INVARIANT_1_RUN_PINNING = "A run pins exactly one immutable flow version";
/**
 * INVARIANT 2: Credentials never enter a flow definition, a queue job, a log,
 * a model prompt, or the Python service. Only connection_id travels;
 * decryption happens in the Node worker at the moment of use.
 * Enforced by: FlowDefinition schema rejects credential fields,
 * internal.decrypt_connection() is service-role only
 */
exports.INVARIANT_2_CREDENTIAL_ISOLATION = "Credentials never enter a flow definition, queue job, log, model prompt, or Python service";
/**
 * INVARIANT 3: Execution context is append-only.
 * A step may add its output under its own id; it may never overwrite
 * another step's output. This makes expression resolution total and
 * makes replay meaningful.
 * Enforced by: context || operator in checkpoint UPDATE
 */
exports.INVARIANT_3_APPEND_ONLY_CONTEXT = "Execution context is append-only";
/**
 * INVARIANT 4: At-least-once delivery with idempotent side effects.
 * The queue may deliver twice; the piece action must not act twice.
 * Every side-effecting action carries an idempotency key derived from
 * stable inputs.
 * Enforced by: effect_key unique constraint, run_steps.completedByEffectKey()
 */
exports.INVARIANT_4_IDEMPOTENT_SIDE_EFFECTS = "At-least-once delivery with idempotent side effects";
/**
 * INVARIANT 5: The AI plane is advisory at build time and bounded at run time.
 * It proposes drafts; it never publishes. It executes within schema,
 * budget, timeout, and tool allow-list.
 * Enforced by: capability envelope (Part 8), COPILOT_FORBIDDEN:publish
 */
exports.INVARIANT_5_AI_ADVISORY = "AI is advisory at build time and bounded at run time";
/**
 * INVARIANT 6: Tool execution always happens in Node.
 * Python may decide that a tool should run and with what arguments;
 * it may never run it, because running it requires a credential.
 * Enforced by: Python has no grant on connections, tool callback to Node
 */
exports.INVARIANT_6_TOOL_EXECUTION_IN_NODE = "Tool execution always happens in Node, never in Python";
/**
 * INVARIANT 7: Tenant isolation is enforced twice — once in application code,
 * once by Postgres RLS. Either alone is a single point of failure.
 * Enforced by: RLS policies + application-level org checks
 */
exports.INVARIANT_7_DUAL_TENANT_ISOLATION = "Tenant isolation enforced twice: application code + Postgres RLS";
/**
 * INVARIANT 8: Versions and audit logs are immutable at the database level,
 * by trigger, not by convention.
 * Enforced by: prevent_flow_version_change trigger, audit_logs has no
 * UPDATE or DELETE policy
 */
exports.INVARIANT_8_IMMUTABLE_VERSIONS = "Versions and audit logs are immutable at the database level, by trigger";
/**
 * INVARIANT 9: Every AI call is attributed to an org, a flow, a purpose,
 * and a run or copilot session, with tokens and cost recorded.
 * Unattributed spend is unmanageable spend.
 * Enforced by: ai_usage table requires org_id, Attribution model
 */
exports.INVARIANT_9_AI_ATTRIBUTION = "Every AI call is attributed to org, flow, purpose, and run/session";
// ── Capability envelope (Part 8) ───────────────────────────────────────────
/**
 * What Copilot may do (allow-list)
 */
exports.COPilot_CAPABILITIES = {
    may: [
        "select_existing_connection",
        "read_operation_schemas",
        "read_sample_output",
        "request_trigger_sample",
        "write_draft",
        "add_step",
        "set_field",
        "add_logic",
        "compile_condition",
        "refine_draft",
        "suggest_next_steps",
    ],
    mayNot: [
        "publish_flow",
        "create_credential",
        "read_credential_secret",
        "execute_write_action",
        "delete_flow",
        "change_billing",
        "impersonate_user",
        "access_connection_plaintext",
        "call_external_apis",
    ],
};
/**
 * Assert a capability is allowed. Throws if forbidden.
 */
function assertCapability(capability) {
    if (exports.COPilot_CAPABILITIES.mayNot.includes(capability)) {
        throw new Error(`COPILOT_FORBIDDEN: ${capability}`);
    }
    if (!exports.COPilot_CAPABILITIES.may.includes(capability)) {
        throw new Error(`COPILOT_UNKNOWN_CAPABILITY: ${capability}`);
    }
}
