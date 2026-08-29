import { type WorkflowGraph, normalizeWorkflowGraph } from "@algoverge/shared";
import { getApp } from "./catalog/catalog";
import { query } from "./db";
import { connectionsAreCompatible } from "./connections";

export type WorkflowIssue = { code: string; message: string; nodeId?: string; edgeId?: string };

/** Validate the persisted graph before it can become a live workflow. Drafts may stay incomplete. */
export async function validateWorkflowGraph(raw: unknown, opts: { workspaceId: string; strict: boolean }) {
  const graph = normalizeWorkflowGraph(raw);
  const issues: WorkflowIssue[] = [];
  const byId = new Map<string, (typeof graph.nodes)[number]>();

  for (const node of graph.nodes) {
    if (containsCredentialMaterial(node.config)) {
      issues.push({
        code: "credential_material",
        message: "Workflow configuration cannot contain credentials. Use a connection instead.",
        nodeId: node.id
      });
    }
    if (byId.has(node.id)) issues.push({ code: "duplicate_node", message: `Duplicate node ID: ${node.id}`, nodeId: node.id });
    byId.set(node.id, node);
  }

  const triggerNodes = graph.nodes.filter((node) => node.type === "trigger");
  if (opts.strict && triggerNodes.length !== 1) {
    issues.push({ code: "trigger_count", message: "A published automation must have exactly one trigger." });
  }

  for (const edge of graph.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) {
      issues.push({ code: "invalid_edge", message: "An edge references a missing node.", edgeId: edge.id });
    }
  }

  if (triggerNodes.length === 1) {
    const reachable = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) {
        issues.push({ code: "cycle", message: "Workflow graphs cannot contain cycles.", nodeId: id });
        return;
      }
      if (reachable.has(id)) return;
      reachable.add(id);
      visiting.add(id);
      for (const edge of graph.edges.filter((candidate) => candidate.source === id)) visit(edge.target);
      visiting.delete(id);
    };
    visit(triggerNodes[0].id);
    if (opts.strict) {
      for (const node of graph.nodes) {
        if (!reachable.has(node.id)) issues.push({ code: "orphan_node", message: "Every published step must be reachable from the trigger.", nodeId: node.id });
      }
    }
  }

  const connectionIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!node.appSlug || !node.operation) {
      if (opts.strict) issues.push({ code: "incomplete_step", message: "Every published step needs an app and event.", nodeId: node.id });
      continue;
    }
    const app = getApp(node.appSlug);
    const operation = app?.operations.find((candidate) => candidate.key === node.operation);
    if (!app || !operation) {
      issues.push({ code: "unknown_operation", message: `Unknown app operation: ${node.appSlug}.${node.operation}`, nodeId: node.id });
      continue;
    }
    if (node.type === "trigger" && operation.type !== "trigger") {
      issues.push({ code: "invalid_trigger", message: "The trigger node must use a trigger operation.", nodeId: node.id });
    }
    if (opts.strict && node.type !== "trigger" && operation.type === "trigger") {
      issues.push({ code: "trigger_as_step", message: "Trigger operations cannot be used as downstream steps.", nodeId: node.id });
    }
    if (opts.strict) {
      for (const field of operation.inputFields ?? []) {
        if (!field.required) continue;
        const value = node.config?.[field.key];
        const empty = value === undefined || value === null || (typeof value === "string" && !value.trim());
        if (empty) {
          issues.push({
            code: "missing_required_field",
            message: `${node.label || operation.name}: ${field.label} is required before publishing.`,
            nodeId: node.id
          });
        }
      }
    }
    if (app.authType && app.authType !== "none") {
      if (!node.connectionId && opts.strict) {
        issues.push({ code: "missing_connection", message: `Connect ${app.name} before publishing.`, nodeId: node.id });
      }
      if (node.connectionId) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(node.connectionId)) {
          issues.push({ code: "invalid_connection", message: "Step connection ID is invalid.", nodeId: node.id });
        } else {
          connectionIds.add(node.connectionId);
        }
      }
    }
  }

  if (connectionIds.size) {
    const rows = await query<{ id: string; app_slug: string; status: string }>(
      `select id, piece_name as app_slug, status from connections where org_id=$1 and id = any($2::uuid[])`,
      [opts.workspaceId, [...connectionIds]]
    );
    const connections = new Map(rows.map((row) => [row.id, row]));
    for (const node of graph.nodes) {
      if (!node.connectionId) continue;
      const connection = connections.get(node.connectionId);
      if (!connection) {
        issues.push({ code: "connection_scope", message: "Step connection is unavailable in this workspace.", nodeId: node.id });
      } else if (connection.status !== "active") {
        issues.push({ code: "connection_unavailable", message: "Step connection needs to be reconnected before publishing.", nodeId: node.id });
      } else if (node.appSlug && !connectionsAreCompatible(node.appSlug, connection.app_slug)) {
        issues.push({ code: "connection_app", message: "Step connection belongs to a different app.", nodeId: node.id });
      }
    }
  }

  return { graph, issues };
}

function containsCredentialMaterial(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCredentialMaterial);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    /^(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|private[_-]?key|secret)$/i.test(key)
    || containsCredentialMaterial(child)
  );
}
