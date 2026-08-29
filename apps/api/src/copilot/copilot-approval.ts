import { Router } from "express";
import { z } from "zod";
import { coerceWorkflowGraph } from "@algoverge/core";
import { query, queryOne } from "../db";
import { authMiddleware, orgMiddleware, requireRole } from "../auth";
import { applyAgentOperations, type AgentOperation } from "../agent-operation-applier";
import { persistBuilderDraft } from "../flow-runtime";

export const copilotApprovalRouter = Router();

const approveBody = z.object({
  flowId: z.string().uuid().optional(),
});

/**
 * Explicit approval boundary for Copilot proposals.
 * Approval never trusts operations supplied by the browser. The server takes
 * the exact confirmation-gated operations recorded in the latest proposal.
 */
copilotApprovalRouter.post("/copilot/sessions/:id/approve", authMiddleware, orgMiddleware, requireRole("owner", "admin", "editor"), async (req, res) => {
  const body = approveBody.parse(req.body ?? {});
  const session = await queryOne<{
    id: string;
    org_id: string;
    flow_id: string | null;
    proposed_definition: unknown;
    status: string | null;
  }>(
    `SELECT id, org_id, flow_id, proposed_definition, status
       FROM copilot_sessions
      WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!session) return res.status(404).json({ error: "not_found" });
  if (session.status === "completed") return res.status(409).json({ error: "proposal_already_approved" });

  const proposalEvent = await queryOne<{ payload: any }>(
    `SELECT payload
       FROM copilot_events
      WHERE session_id = $1 AND org_id = $2 AND event_type = 'proposal'
      ORDER BY sequence_no DESC
      LIMIT 1`,
    [session.id, req.orgId],
  );
  const payload = proposalEvent?.payload ?? {};
  const pending = Array.isArray(payload.needs_confirmation) ? payload.needs_confirmation : [];
  if (!pending.length) {
    return res.status(409).json({ error: "no_pending_confirmation", message: "There are no confirmation-gated Copilot operations waiting for approval." });
  }

  // Never accept an operation list from the browser. The exact server-recorded
  // pending proposal is the only thing this endpoint can approve.
  const operations = pending as AgentOperation[];

  const requestedFlowId = body.flowId ?? session.flow_id;
  if (body.flowId && session.flow_id && body.flowId !== session.flow_id) {
    return res.status(409).json({ error: "flow_mismatch" });
  }

  let currentGraph: unknown;
  if (requestedFlowId) {
    const flow = await queryOne<{ draft_definition: unknown }>(
      `SELECT draft_definition FROM flows WHERE id = $1 AND org_id = $2`,
      [requestedFlowId, req.orgId],
    );
    if (!flow) return res.status(404).json({ error: "flow_not_found" });
    currentGraph = flow.draft_definition;
  } else {
    currentGraph = payload.graph ?? session.proposed_definition;
  }
  if (!currentGraph) return res.status(409).json({ error: "no_current_graph" });

  // Re-run the complete applier with explicit approval. This rechecks the real
  // catalog, current node/edge references and resulting workflow immediately
  // before persistence, preventing stale or tampered proposals from applying.
  const result = await applyAgentOperations({
    graph: coerceWorkflowGraph(currentGraph),
    operations,
    workspaceId: req.orgId!,
    organizationId: req.orgId!,
    allowDestructive: true,
  });

  if (result.rejected.length || result.needsConfirmation.length || result.issues.some((issue) => issue.code === "INVALID_WORKFLOW")) {
    return res.status(409).json({
      error: "approval_rejected",
      applied_operations: result.applied,
      rejected_operations: result.rejected,
      needs_confirmation: result.needsConfirmation,
      issues: result.issues,
    });
  }

  const definition = persistBuilderDraft(result.graph);
  if (requestedFlowId) {
    await query(
      `UPDATE flows SET draft_definition = $3, updated_at = now(), updated_by = $4 WHERE id = $1 AND org_id = $2`,
      [requestedFlowId, req.orgId, JSON.stringify(definition), req.user!.userId],
    );
  }

  await query(
    `UPDATE copilot_sessions
        SET proposed_definition = $1, status = 'completed', stage = 'persist', updated_at = now()
      WHERE id = $2 AND org_id = $3 AND status IS DISTINCT FROM 'completed'`,
    [JSON.stringify(definition), session.id, req.orgId],
  );

  await query(
    `INSERT INTO audit_logs (org_id, actor_id, actor_kind, action, target_type, target_id, metadata)
     VALUES ($1, $2, 'user', 'copilot_approve', 'flow', $3, $4)`,
    [req.orgId, req.user!.userId, requestedFlowId ?? session.id, JSON.stringify({ sessionId: session.id, operationCount: operations.length })],
  );

  res.json({
    ok: true,
    sessionId: session.id,
    flowId: requestedFlowId,
    graph: result.graph,
    definition,
    applied_operations: result.applied,
    rejected_operations: [],
    needs_confirmation: [],
    issues: result.issues,
    publishable: result.issues.length === 0,
  });
});
