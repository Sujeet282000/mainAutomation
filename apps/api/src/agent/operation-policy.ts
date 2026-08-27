import type { AgentOperation } from "../agent-operation-applier";

export type AgentOperationRisk = "safe" | "confirmation" | "external";

const EXTERNAL_OPERATIONS = new Set<AgentOperation["kind"]>(["test_action"]);
const CONFIRMATION_OPERATIONS = new Set<AgentOperation["kind"]>(["remove_node", "disconnect_nodes"]);

export function getAgentOperationRisk(operation: AgentOperation): AgentOperationRisk {
  if (operation.requires_confirmation === true) return "confirmation";
  if (EXTERNAL_OPERATIONS.has(operation.kind)) return "external";
  if (CONFIRMATION_OPERATIONS.has(operation.kind)) return "confirmation";
  return "safe";
}

export function operationRequiresApproval(operation: AgentOperation, autoBuild: boolean): boolean {
  if (getAgentOperationRisk(operation) === "safe") return false;
  return !autoBuild || getAgentOperationRisk(operation) !== "external";
}

export function operationSummary(operation: AgentOperation): string {
  const args = operation.arguments;
  switch (operation.kind) {
    case "add_node": return `Add ${String(args.appSlug ?? "integration")} step`;
    case "remove_node": return `Remove workflow step ${String(args.nodeId ?? "")}`;
    case "update_node":
    case "configure_node": return `Configure workflow step ${String(args.nodeId ?? "")}`;
    case "connect_nodes": return `Connect ${String(args.source ?? args.sourceNodeId ?? "")} → ${String(args.target ?? args.targetNodeId ?? "")}`;
    case "disconnect_nodes": return `Disconnect ${String(args.source ?? args.sourceNodeId ?? "")} → ${String(args.target ?? args.targetNodeId ?? "")}`;
    case "map_field": return `Map ${String(args.field ?? "field")} on ${String(args.nodeId ?? "step")}`;
    case "validate_workflow": return "Validate workflow";
    case "test_action": return `Test workflow step ${String(args.nodeId ?? "")}`;
    case "explain_run": return `Explain run ${String(args.runId ?? "")}`;
  }
}
