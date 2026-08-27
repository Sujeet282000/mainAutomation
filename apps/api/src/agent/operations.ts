import { z } from "zod";

/**
 * The only mutation vocabulary exposed to the Agent/Copilot planner.
 * The planner proposes operations; the API remains the authority that
 * validates and applies them to the canonical WorkflowGraph.
 */
export const AgentOperation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ADD_NODE"), node: z.object({
    id: z.string().min(1),
    type: z.enum(["trigger", "action", "logic"]),
    appSlug: z.string().min(1),
    operation: z.string().min(1),
    label: z.string().min(1),
    position: z.object({ x: z.number(), y: z.number() }),
    config: z.record(z.unknown()).default({}),
    connectionId: z.string().nullable().optional()
  }) }),
  z.object({ type: z.literal("REMOVE_NODE"), nodeId: z.string().min(1) }),
  z.object({ type: z.literal("UPDATE_NODE"), nodeId: z.string().min(1), patch: z.object({
    label: z.string().min(1).optional(),
    appSlug: z.string().min(1).optional(),
    operation: z.string().min(1).optional(),
    type: z.enum(["trigger", "action", "logic"]).optional(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
    config: z.record(z.unknown()).optional(),
    connectionId: z.string().nullable().optional()
  }) }),
  z.object({ type: z.literal("CONNECT_NODES"), source: z.string().min(1), target: z.string().min(1), sourceHandle: z.string().nullable().optional(), condition: z.record(z.unknown()).nullable().optional() }),
  z.object({ type: z.literal("DISCONNECT_NODES"), source: z.string().min(1), target: z.string().min(1) }),
  z.object({ type: z.literal("MAP_FIELD"), nodeId: z.string().min(1), field: z.string().min(1), value: z.unknown() }),
  z.object({ type: z.literal("CONFIGURE_NODE"), nodeId: z.string().min(1), config: z.record(z.unknown()) }),
  z.object({ type: z.literal("VALIDATE_WORKFLOW") }),
  z.object({ type: z.literal("TEST_WORKFLOW") }),
  z.object({ type: z.literal("EXPLAIN_WORKFLOW") })
]);

export type AgentOperation = z.infer<typeof AgentOperation>;
export type AgentMutationOperation = Exclude<AgentOperation, { type: "VALIDATE_WORKFLOW" | "TEST_WORKFLOW" | "EXPLAIN_WORKFLOW" }>;

export const AGENT_MUTATING_OPERATION_TYPES = new Set<AgentMutationOperation["type"]>([
  "ADD_NODE", "REMOVE_NODE", "UPDATE_NODE", "CONNECT_NODES", "DISCONNECT_NODES", "MAP_FIELD", "CONFIGURE_NODE"
]);
