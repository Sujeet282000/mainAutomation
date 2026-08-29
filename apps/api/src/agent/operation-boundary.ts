import type { GraphNode, WorkflowGraph } from "@algoverge/shared";
import { APP_CATALOG } from "../catalog/catalog";
import { pieceRegistry } from "../pieces/registry";
import { validateWorkflowGraph } from "../workflow-validation";
import { AgentOperation, parseAgentOperations, AGENT_MUTATING_OPERATION_TYPES, type AgentOperation as AgentOperationType } from "./operations";

export type AgentBoundaryMode = "preview" | "apply";

export type AgentBoundaryResult = {
  ok: boolean;
  status: "applied" | "confirmation_required" | "rejected";
  graph: WorkflowGraph;
  operations: AgentOperationType[];
  applied: AgentOperationType[];
  pending: AgentOperationType[];
  errors: string[];
  warnings: string[];
};

const HIGH_RISK = new Set<AgentOperationType["kind"]>([
  "remove_node",
  "disconnect_nodes",
  "test_action",
]);

function app(slug: unknown) {
  return typeof slug === "string" ? APP_CATALOG.find((item) => item.slug === slug) : undefined;
}

function operationExists(slug: unknown, key: unknown, expected: "trigger" | "action" | undefined = undefined) {
  const manifest = app(slug);
  if (!manifest || !pieceRegistry.has(manifest.slug)) return false;
  const operation = manifest.operations.find((item) => item.key === key);
  return Boolean(operation && (!expected || operation.type === expected));
}

function node(graph: WorkflowGraph, id: unknown) {
  return typeof id === "string" ? graph.nodes.find((item) => item.id === id) : undefined;
}

function hasCredentialMaterial(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCredentialMaterial);
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (/^(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|private[_-]?key|secret)$/i.test(key)) return true;
    if (hasCredentialMaterial(child)) return true;
  }
  return false;
}

function operationNeedsConfirmation(operation: AgentOperationType) {
  return operation.requires_confirmation === true || HIGH_RISK.has(operation.kind);
}

/**
 * Validate AI operations without mutating the supplied graph.
 * This is the security boundary: an LLM never gets direct authority over the graph.
 */
export function validateAgentOperations(raw: unknown, graph: WorkflowGraph): { operations: AgentOperationType[]; errors: string[]; warnings: string[] } {
  let operations: AgentOperationType[];
  try {
    operations = parseAgentOperations(raw);
  } catch (error) {
    return { operations: [], errors: [error instanceof Error ? error.message : "Invalid AgentOperation payload"], warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set(graph.nodes.map((item) => item.id));

  operations.forEach((operation, index) => {
    const args = operation.arguments ?? {};
    const prefix = `Operation ${index + 1} (${operation.kind})`;

    const isMutating = operation.kind !== "validate_workflow" && operation.kind !== "test_action" && operation.kind !== "explain_run";
    if (isMutating && AGENT_MUTATING_OPERATION_TYPES.has(operation.kind as typeof AGENT_MUTATING_OPERATION_TYPES extends Set<infer T> ? T : never) && hasCredentialMaterial(args)) {
      errors.push(`${prefix}: credential or secret material is not allowed in AgentOperation arguments.`);
      return;
    }

    if (operation.kind === "add_node") {
      const slug = args.appSlug;
      const key = args.operation;
      if (!operationExists(slug, key)) errors.push(`${prefix}: ${String(slug)} → ${String(key)} is not a registered catalog operation.`);
      if (typeof args.id !== "string" || !args.id.trim()) errors.push(`${prefix}: id is required.`);
      else if (ids.has(args.id)) errors.push(`${prefix}: node id ${args.id} already exists.`);
      else ids.add(String(args.id));
    }

    if (["remove_node", "update_node", "configure_node", "map_field"].includes(operation.kind)) {
      if (!node(graph, args.nodeId)) errors.push(`${prefix}: nodeId does not exist.`);
    }

    if (operation.kind === "update_node" || operation.kind === "configure_node") {
      const target = node(graph, args.nodeId);
      if (target && args.operation !== undefined && !operationExists(target.appSlug, args.operation)) {
        errors.push(`${prefix}: operation is not registered for ${target.appSlug}.`);
      }
    }

    if (operation.kind === "connect_nodes" || operation.kind === "disconnect_nodes") {
      if (!node(graph, args.source)) errors.push(`${prefix}: source node does not exist.`);
      if (!node(graph, args.target)) errors.push(`${prefix}: target node does not exist.`);
      if (args.source === args.target) errors.push(`${prefix}: source and target must differ.`);
    }

    if (operation.kind === "test_action") {
      if (!node(graph, args.nodeId)) errors.push(`${prefix}: nodeId does not exist.`);
      warnings.push(`${prefix}: external test execution requires explicit confirmation.`);
    }

    if (operation.kind === "explain_run" && typeof args.runId !== "string") {
      errors.push(`${prefix}: runId is required.`);
    }
  });

  return { operations, errors, warnings };
}

function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return JSON.parse(JSON.stringify(graph)) as WorkflowGraph;
}

function applyOne(graph: WorkflowGraph, operation: AgentOperationType): void {
  const args = operation.arguments ?? {};
  switch (operation.kind) {
    case "add_node": {
      const id = String(args.id);
      const node: GraphNode = {
        id,
        type: args.type === "trigger" ? "trigger" : "action",
        appSlug: String(args.appSlug),
        operation: String(args.operation),
        label: typeof args.label === "string" ? args.label : String(args.operation),
        position: typeof args.position === "object" && args.position ? args.position as { x: number; y: number } : { x: 280, y: 200 },
        config: typeof args.config === "object" && args.config ? args.config as Record<string, unknown> : {},
        connectionId: typeof args.connectionId === "string" ? args.connectionId : null,
      };
      graph.nodes.push(node);
      break;
    }
    case "remove_node": {
      const id = String(args.nodeId);
      graph.nodes = graph.nodes.filter((item) => item.id !== id);
      graph.edges = graph.edges.filter((edge) => edge.source !== id && edge.target !== id);
      break;
    }
    case "update_node": {
      const target = node(graph, args.nodeId)!;
      if (typeof args.label === "string") target.label = args.label;
      if (typeof args.operation === "string") target.operation = args.operation;
      if (typeof args.appSlug === "string") target.appSlug = args.appSlug;
      if (args.position && typeof args.position === "object") target.position = args.position as { x: number; y: number };
      break;
    }
    case "configure_node": {
      const target = node(graph, args.nodeId)!;
      const patch = args.config;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("configure_node.config must be an object");
      target.config = { ...(target.config ?? {}), ...(patch as Record<string, unknown>) };
      break;
    }
    case "connect_nodes": {
      const source = String(args.source);
      const target = String(args.target);
      const id = typeof args.id === "string" ? args.id : `e-${source}-${target}`;
      if (!graph.edges.some((edge) => edge.source === source && edge.target === target)) graph.edges.push({ id, source, target });
      break;
    }
    case "disconnect_nodes":
      graph.edges = graph.edges.filter((edge) => !(edge.source === args.source && edge.target === args.target));
      break;
    case "map_field": {
      const target = node(graph, args.nodeId)!;
      const field = String(args.field);
      if (!field) throw new Error("map_field.field is required");
      target.config = { ...(target.config ?? {}), [field]: String(args.value ?? "") };
      break;
    }
    case "validate_workflow":
    case "test_action":
    case "explain_run":
      break;
  }
}

/**
 * Single controlled boundary for AI-proposed graph changes.
 * Preview never mutates. Apply clones, applies, then validates the final graph.
 */
export async function executeAgentOperations(raw: unknown, graph: WorkflowGraph, mode: AgentBoundaryMode = "preview"): Promise<AgentBoundaryResult> {
  const checked = validateAgentOperations(raw, graph);
  if (checked.errors.length) {
    return { ok: false, status: "rejected", graph, operations: checked.operations, applied: [], pending: [], errors: checked.errors, warnings: checked.warnings };
  }

  const pending = checked.operations.filter(operationNeedsConfirmation);
  if (mode === "preview" || pending.length) {
    return {
      ok: pending.length === 0,
      status: pending.length ? "confirmation_required" : "applied",
      graph,
      operations: checked.operations,
      applied: pending.length ? [] : checked.operations,
      pending,
      errors: [],
      warnings: checked.warnings,
    };
  }

  const next = cloneGraph(graph);
  try {
    for (const operation of checked.operations) applyOne(next, operation);
  } catch (error) {
    return { ok: false, status: "rejected", graph, operations: checked.operations, applied: [], pending: [], errors: [error instanceof Error ? error.message : "Agent operation failed"], warnings: checked.warnings };
  }

  const validation = await validateWorkflowGraph(next, { workspaceId: "", strict: false });
  if (validation.issues.length) {
    return { ok: false, status: "rejected", graph, operations: checked.operations, applied: [], pending: [], errors: validation.issues.map((issue) => issue.message), warnings: checked.warnings };
  }

  return { ok: true, status: "applied", graph: next, operations: checked.operations, applied: checked.operations, pending: [], errors: [], warnings: checked.warnings };
}

export { AgentOperation };
