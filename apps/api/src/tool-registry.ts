import { createHash } from "node:crypto";
import { createHttpClient } from "@algoverge/pieces-sdk";
import { runAdapter } from "./adapters";
import { loadCompatibleConnectionAuth, touchConnection } from "./connections";
import { recordUsage, taskUnitsForStep } from "./metering";
import { pieceRegistry } from "./pieces/registry";

export type ToolInvokeInput = {
  piece: string;
  operation: string;
  connectionId?: string | null;
  props: Record<string, unknown>;
  workspaceId: string;
  organizationId: string;
  executionId: string;
  idempotencyKey: string;
  allowDestructive?: boolean;
  source: "engine" | "agent" | "mcp";
};

function memoryStore() {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async put(key: string, value: unknown) {
      data.set(key, value);
    }
  };
}

/** Single action path for engine, agents, and MCP. */
export async function invokeTool(input: ToolInvokeInput) {
  const action = pieceRegistry.getAction(input.piece, input.operation);
  if (action.sideEffect === "delete" && !input.allowDestructive) {
    throw new Error(`DESTRUCTIVE_REQUIRES_APPROVAL:${input.piece}.${input.operation}`);
  }
  const resolvedConnection = await loadCompatibleConnectionAuth(input.connectionId, input.workspaceId, input.piece);
  const auth = resolvedConnection.auth;
  if (resolvedConnection.connectionId) await touchConnection(resolvedConnection.connectionId, input.workspaceId);
  const http = await createHttpClient({ idempotencyKey: input.idempotencyKey });
  const result = await runAdapter({
    appSlug: input.piece,
    operation: input.operation,
    input: input.props,
    auth,
    workspaceId: input.workspaceId,
    executionId: input.executionId,
    connectionId: resolvedConnection.connectionId ?? undefined,
    idempotencyKey: input.idempotencyKey
  });
  const units = taskUnitsForStep({
    appSlug: input.piece,
    isTrigger: false,
    byok: Boolean(auth?.api_key),
    mcp: input.source === "mcp"
  });
  await recordUsage({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    metric: "tasks",
    quantity: units,
    metadata: { source: input.source, piece: input.piece, operation: input.operation, executionId: input.executionId }
  });
  if (input.source === "engine") {
    await recordUsage({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      metric: "steps_billable",
      quantity: units,
      metadata: { executionId: input.executionId }
    });
  }
  void http;
  void memoryStore;
  return result;
}

export function toolIdempotencyKey(parts: {
  executionId: string;
  stepId: string;
  attempt: number;
  piece: string;
  operation: string;
}) {
  return createHash("sha256")
    .update(`${parts.executionId}:${parts.stepId}:${parts.attempt}:${parts.piece}:${parts.operation}`)
    .digest("hex");
}
