import { z } from "zod";

/**
 * Canonical control vocabulary exchanged between the AI planner and API.
 * The API remains the authority that validates and applies operations.
 */
export const AgentOperation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add_node"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("remove_node"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("update_node"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("configure_node"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("connect_nodes"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("disconnect_nodes"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("map_field"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("validate_workflow"), arguments: z.record(z.unknown()).default({}), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("test_action"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
  z.object({ kind: z.literal("explain_run"), arguments: z.record(z.unknown()), requires_confirmation: z.boolean().optional() }),
]);

export type AgentOperation = z.infer<typeof AgentOperation>;

export const AGENT_MUTATING_OPERATION_TYPES = new Set([
  "add_node",
  "remove_node",
  "update_node",
  "configure_node",
  "connect_nodes",
  "disconnect_nodes",
  "map_field",
] as const);

export function parseAgentOperations(raw: unknown): AgentOperation[] {
  if (!Array.isArray(raw)) throw new Error("Agent operations must be an array");
  return raw.map((operation, index) => {
    const parsed = AgentOperation.safeParse(operation);
    if (!parsed.success) {
      throw new Error(`Invalid AgentOperation at index ${index}: ${parsed.error.message}`);
    }
    return parsed.data;
  });
}
