import { runAdapter } from "../../api/src/adapters";
import { loadConnectionAuth } from "../../api/src/connections";
import { EngineError, type StepHandler } from "@algoverge/engine";

/**
 * Compatibility bridge while integration implementations are migrated from
 * the API application into packages/pieces. Existing adapter implementations
 * remain untouched; the canonical engine invokes them through this boundary.
 */
export const adapterStepHandler: StepHandler = {
  async execute({ run, step, props, context, idempotencyKey }) {
    const raw = step as Record<string, any>;
    const piece = raw.piece as Record<string, unknown> | undefined;
    const appSlug = String(piece?.name ?? raw.appSlug ?? raw.app ?? raw.type ?? "");
    const operation = String(raw.operation ?? raw.operationId ?? props.operation ?? raw.action ?? "");
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
        input: { ...props, context, idempotencyKey },
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
