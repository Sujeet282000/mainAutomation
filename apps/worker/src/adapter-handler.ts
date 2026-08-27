import { runAdapter } from "../../api/src/adapters";
import { loadConnectionAuth } from "../../api/src/connections";
import { EngineError, type StepHandler } from "@algoverge/engine";

/**
 * Compatibility bridge while integration implementations are migrated from
 * the API application into packages/pieces. No adapter implementation is
 * duplicated or removed; the canonical engine simply invokes the existing
 * handlers through this boundary.
 */
export const adapterStepHandler: StepHandler = {
  async execute({ run, step, props, context, idempotencyKey }) {
    const raw = step as Record<string, unknown>;
    const appSlug = String(raw.appSlug ?? raw.app ?? "");
    const operation = String(raw.operation ?? raw.operationId ?? raw.action ?? "");
    const connectionId = raw.connectionId ? String(raw.connectionId) : undefined;

    if (!appSlug || !operation) {
      return { kind: "error", error: new EngineError("validation", "INVALID_STEP") };
    }

    try {
      const auth = connectionId
        ? await loadConnectionAuth(connectionId, run.orgId)
        : null;
      const result = await runAdapter({
        appSlug,
        operation,
        input: props,
        auth,
        workspaceId: run.orgId,
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
