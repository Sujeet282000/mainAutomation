export type AgentCapability =
  | "READ_WORKFLOW"
  | "READ_CATALOG"
  | "READ_CONNECTIONS"
  | "ADD_NODE"
  | "REMOVE_NODE"
  | "UPDATE_NODE"
  | "CONNECT_NODES"
  | "DISCONNECT_NODES"
  | "MAP_FIELD"
  | "CONFIGURE_NODE"
  | "VALIDATE_WORKFLOW"
  | "TEST_WORKFLOW"
  | "EXPLAIN_WORKFLOW"
  | "PUBLISH_WORKFLOW"
  | "DISCONNECT_ACCOUNT"
  | "SEND_EXTERNAL_MESSAGE";

export type CapabilityDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
};

/**
 * Central policy for agent intent. Tool allow-lists still remain mandatory;
 * this policy adds a second safety boundary based on what the operation does.
 */
const READ_ONLY = new Set<AgentCapability>([
  "READ_WORKFLOW",
  "READ_CATALOG",
  "READ_CONNECTIONS",
  "VALIDATE_WORKFLOW",
  "EXPLAIN_WORKFLOW"
]);

const MUTATIONS = new Set<AgentCapability>([
  "ADD_NODE",
  "REMOVE_NODE",
  "UPDATE_NODE",
  "CONNECT_NODES",
  "DISCONNECT_NODES",
  "MAP_FIELD",
  "CONFIGURE_NODE",
  "TEST_WORKFLOW"
]);

const HIGH_IMPACT = new Set<AgentCapability>([
  "PUBLISH_WORKFLOW",
  "DISCONNECT_ACCOUNT",
  "SEND_EXTERNAL_MESSAGE"
]);

export function decideCapability(capability: AgentCapability, opts: { explicitApproval?: boolean } = {}): CapabilityDecision {
  if (READ_ONLY.has(capability)) {
    return { allowed: true, requiresApproval: false, reason: "read-only capability" };
  }
  if (HIGH_IMPACT.has(capability)) {
    return {
      allowed: opts.explicitApproval === true,
      requiresApproval: true,
      reason: opts.explicitApproval === true ? "explicit approval supplied" : "high-impact action requires explicit user approval"
    };
  }
  if (MUTATIONS.has(capability)) {
    return { allowed: true, requiresApproval: false, reason: "workflow-scoped mutation" };
  }
  return { allowed: false, requiresApproval: false, reason: "unknown capability" };
}

export function capabilityForAgentOperation(type: string): AgentCapability | null {
  switch (type) {
    case "ADD_NODE": return "ADD_NODE";
    case "REMOVE_NODE": return "REMOVE_NODE";
    case "UPDATE_NODE": return "UPDATE_NODE";
    case "CONNECT_NODES": return "CONNECT_NODES";
    case "DISCONNECT_NODES": return "DISCONNECT_NODES";
    case "MAP_FIELD": return "MAP_FIELD";
    case "CONFIGURE_NODE": return "CONFIGURE_NODE";
    case "VALIDATE_WORKFLOW": return "VALIDATE_WORKFLOW";
    case "TEST_WORKFLOW": return "TEST_WORKFLOW";
    case "EXPLAIN_WORKFLOW": return "EXPLAIN_WORKFLOW";
    default: return null;
  }
}
