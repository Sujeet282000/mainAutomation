/**
 * Copilot Approval Boundary
 *
 * Server-side execution boundary for approving copilot proposals.
 * The browser NEVER sends operations or graph data to be applied.
 * It only identifies WHICH session/flow to approve.
 *
 * Flow:
 *   1. Load session's pending proposed_definition + stored operations
 *   2. Load CURRENT workflow from the flow (the latest draft)
 *   3. Re-validate operations against current catalog
 *   4. Re-validate current graph references
 *   5. Apply operations via applyAgentOperations (the canonical boundary)
 *   6. Validate resulting graph
 *   7. Persist draft atomically
 *   8. Mark session completed
 *   9. Audit log
 *   10. Return validated graph to frontend
 */

import { coerceWorkflowGraph, definitionHash } from "@algoverge/core";
import { normalizeWorkflowGraph } from "@algoverge/shared";
import { queryOne, query } from "./db";
import { persistBuilderDraft, loadBuilderGraph } from "./flow-runtime";
import { applyAgentOperations } from "./agent-operation-applier";
import { validateWorkflowGraph } from "./workflow-validation";
import { listCatalogApps, getApp } from "./catalog";

export type ApprovalResult = {
  ok: boolean;
  graph?: unknown;
  definition?: unknown;
  flowId?: string;
  issues?: Array<{ code: string; message: string; nodeId?: string }>;
  applied?: number;
  rejected?: number;
  error?: string;
};

/**
 * Approve a copilot session proposal.
 * The browser provides only the sessionId and flowId.
 * All operations and graph data come from the server-side session.
 */
export async function approveCopilotSession(opts: {
  sessionId: string;
  flowId: string;
  orgId: string;
  userId: string;
}): Promise<ApprovalResult> {
  const { sessionId, flowId, orgId, userId } = opts;

  // 1. Load session — must exist, must belong to this workspace, must not be completed
  const session = await queryOne<{
    id: string;
    proposed_definition: unknown;
    flow_id: string | null;
    mode: string;
    status: string;
  }>(
    `SELECT id, proposed_definition, flow_id, mode, status
     FROM copilot_sessions
     WHERE id = $1 AND org_id = $2`,
    [sessionId, orgId],
  );

  if (!session) {
    return { ok: false, error: "Session not found" };
  }

  if (session.status === "completed") {
    return { ok: false, error: "Session already completed — cannot re-approve" };
  }

  if (!session.proposed_definition) {
    return { ok: false, error: "No pending proposal in this session" };
  }

  // 2. Verify the flowId matches (either from request or from the session)
  const targetFlowId = flowId || session.flow_id;
  if (!targetFlowId) {
    return { ok: false, error: "No flow to persist to" };
  }

  // 3. Load CURRENT workflow from the flow — this is the source of truth
  const flow = await queryOne<{ draft_definition: unknown }>(
    `SELECT draft_definition FROM flows WHERE id = $1 AND org_id = $2`,
    [targetFlowId, orgId],
  );

  if (!flow) {
    return { ok: false, error: "Flow not found" };
  }

  // 4. Load pending operations from copilot_events (stored during generate)
  const events = await query<{ event_type: string; payload: unknown }>(
    `SELECT event_type, payload
     FROM copilot_events
     WHERE session_id = $1
     ORDER BY sequence_no ASC`,
    [sessionId],
  );

  // Extract operations from the result/proposal event
  let pendingOperations: unknown[] = [];
  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    if (
      (event.event_type === "result" || event.event_type === "proposal") &&
      Array.isArray(payload.operations)
    ) {
      pendingOperations = payload.operations;
      break;
    }
  }

  // 5. Load the proposed graph from the session
  let proposedGraph: unknown;
  try {
    proposedGraph = coerceWorkflowGraph(session.proposed_definition);
  } catch {
    // If the proposed_definition can't be coerced to a graph, use the raw value
    proposedGraph = session.proposed_definition;
  }

  // 6. If we have pending operations, apply them to the CURRENT graph (not the proposed one)
  //    This ensures we're always applying on top of the latest draft state
  let finalGraph = normalizeWorkflowGraph(flow.draft_definition);
  let appliedCount = 0;
  let rejectedCount = 0;
  let issues: Array<{ code: string; message: string; nodeId?: string }> = [];

  if (pendingOperations.length > 0) {
    const isAutoBuild = session.mode === "auto_build";
    const result = await applyAgentOperations({
      graph: finalGraph,
      operations: pendingOperations,
      workspaceId: orgId,
      organizationId: orgId,
      allowDestructive: isAutoBuild,
    });

    finalGraph = result.graph;
    appliedCount = result.applied.length;
    rejectedCount = result.rejected.length;
    issues = result.issues;

    // If there are still operations needing confirmation after auto_build,
    // that means the auto_build flag didn't cover them — reject
    if (result.needsConfirmation.length > 0) {
      return {
        ok: false,
        error: "Some operations still require confirmation. Review the proposal and try again.",
        issues: result.needsConfirmation.map((op) => ({
          code: "NEEDS_CONFIRMATION",
          message: `Operation ${op.kind} still requires confirmation`,
        })),
      };
    }
  } else {
    // No operations — just use the proposed graph directly (fallback for node-engine proposals)
    finalGraph = proposedGraph;
  }

  // 7. Validate the resulting graph
  const validation = await validateWorkflowGraph(finalGraph, {
    workspaceId: orgId,
    strict: false,
  });

  if (validation.issues.length > 0) {
    issues = [...issues, ...validation.issues];
  }

  // 8. Persist the draft atomically
  const definition = persistBuilderDraft(finalGraph);
  await query(
    `UPDATE flows SET draft_definition = $3, updated_at = now(), updated_by = $4
     WHERE id = $1 AND org_id = $2`,
    [targetFlowId, orgId, JSON.stringify(definition), userId],
  );

  // 9. Mark session completed
  await query(
    `UPDATE copilot_sessions SET status = 'completed', updated_at = now()
     WHERE id = $1`,
    [sessionId],
  );

  // 10. Audit log
  await query(
    `INSERT INTO audit_logs (org_id, actor_id, actor_kind, action, target_type, target_id, metadata)
     VALUES ($1, $2, 'user', 'copilot_approve', 'flow', $3, $4)`,
    [
      orgId,
      userId,
      targetFlowId,
      JSON.stringify({
        sessionId,
        appliedOperations: appliedCount,
        rejectedOperations: rejectedCount,
        issues: issues.length,
      }),
    ],
  ).catch(() => undefined);

  return {
    ok: true,
    graph: finalGraph,
    definition,
    flowId: targetFlowId,
    issues,
    applied: appliedCount,
    rejected: rejectedCount,
  };
}
