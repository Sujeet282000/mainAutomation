import { runAdapter } from "../../api/src/adapters";
import { loadConnectionAuth } from "../../api/src/connections";
import { EngineError, type StepHandler } from "@algoverge/engine";/**
 * Compatibility bridge while integration implementations are migrated from
 * the API application into packages/pieces. Existing adapter implementations
 * remain untouched; the canonical engine invokes them through this boundary.
 *
 * Schema-native step types (http/code/ai/agent/data_table) are mapped onto
 * their adapter equivalents here — the same bridge the API interactive
 * runtime uses — so bridge-built workflow versions execute identically on
 * the worker path instead of failing with NO_HANDLER.
 */
const SCHEMA_STEP_TO_ADAPTER: Record<string, { appSlug: string; operation: (props: Record<string, unknown>) => string }> = {
  http: { appSlug: "http", operation: () => "request" },
  code: { appSlug: "code", operation: () => "javascript", },
  data_table: {
    appSlug: "tables",
    operation: (props) => {
      const op = String(props.operation ?? "find");
      return op === "find" || op === "get" ? "find_record" : `${op}_record`;
    },
  },
  ai: {
    appSlug: "ai",
    operation: (props) => {
      const op = String(props.operation ?? "generate");
      return op === "generate" ? "complete" : op;
    },
  },
  agent: { appSlug: "agents", operation: () => "run" },
};

/** Prop normalization per step type so adapter contracts are met. */
function normalizeProps(type: string, props: Record<string, unknown>): Record<string, unknown> {
  switch (type) {
    case "http":
      return props; // method/url/headers/body/timeoutMs already match httpRequest
    case "code":
      return { code: props.source, inputs: props.inputs, timeoutMs: props.timeoutMs };
    case "ai":
      // Schema AiStep.input may be any JSON; adapters expect text-ish fields.
      return { text: props.input, prompt: props.input, labels: (props as any).labels, schema: (props as any).responseSchema, input: props.input };
    case "agent":
      return { instructions: props.instructions, input: props.input };
    case "data_table":
      return { tableId: props.tableId, data: props.data, query: props.query };
    default:
      return props;
  }
}

export const adapterStepHandler: StepHandler = {
  async execute({ run, step, props, context, idempotencyKey }) {
    const raw = step as Record<string, any>;
    const piece = raw.piece as Record<string, unknown> | undefined;
    const stepType = String(raw.type ?? "");
    const mapping = SCHEMA_STEP_TO_ADAPTER[stepType];
    const appSlug = String(piece?.name ?? raw.appSlug ?? raw.app ?? mapping?.appSlug ?? raw.type ?? "");
    const operation = String(
      raw.operation ??
      raw.operationId ??
      props.operation ??
      (mapping ? mapping.operation(raw.props ?? props) : undefined) ??
      raw.action ??
      ""
    );
    const normalized = mapping ? normalizeProps(stepType, raw.props ?? props) : props;
    const connectionId = raw.connectionId ? String(raw.connectionId) : undefined;
    const workspaceId = run.orgId;
    if (!appSlug || !operation) {
      return { kind: "error", error: new EngineError("validation", "INVALID_STEP") };
    }

    try {
      const auth = connectionId ? await loadConnectionAuth(connectionId, workspaceId) : null;
      const result = await runAdapter({
        appSlug,
        operation,
        input: { ...normalized, context, idempotencyKey },
        auth,
        workspaceId,
        executionId: run.id,
        connectionId,
        idempotencyKey,
      });

      if (result.control === "wait") {
        return {
          kind: "pause",
          reason: result.hold ? "webhook" : "delay",
          resumeAt: result.waitMs ? new Date(Date.now() + result.waitMs).toISOString() : undefined,
        };
      }
      if (result.control === "skip_rest") return { kind: "stop" };
      return { kind: "ok", output: result.output ?? {} };
    } catch (error) {
      return { kind: "error", error: EngineError.from(error) };
    }
  },
};
