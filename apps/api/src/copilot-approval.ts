import { Router } from "express";
import { z } from "zod";
import { coerceWorkflowGraph } from "@algoverge/core";
import { query, queryOne } from "./db";
import { authMiddleware, orgMiddleware, requireRole } from "./auth";
import { applyAgentOperations, type AgentOperation } from "./agent-operation-applier";
import { persistBuilderDraft } from "./flow-runtime";

export const copilotApprovalRouter = Router();
copilotApprovalRouter.use(authMiddleware, orgMiddleware);

const approveBody = z.object({
  operations: z.array(z.unknown()).min(1).optional(),
  graph: z.unknown().optional(),
  flowId: z.string().uuid().optional(),
});

/**
 * Explicit approval boundary for Copilot proposals.
 * The client may send the displayed operations, but the server always checks
 * them against the stored proposal event and the current workspace graph.
 */
copilotApprovalRouter.post("/copilot/sessions/:id/approve", requireRole("owner", "admin", "editor"), async (req, res) => {
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

  const proposalEvent = await queryOne<{ payload: any }>(
    `SELECT payload
       FROM copilot_events
      WHERE session_id = $1 AND org_id = $2 AND event_type IN ('proposal', 'result')
      ORDER BY sequence_no DESC
      LIMIT 1`,
    [session.id, req.orgId],
  );
  const payload = proposalEvent?.payload ?? {};
  const storedOperations = Array.isArray(payload.operations) ? payload.operations : [];
  const operations = (body.operations ?? storedOperations) as AgentOperation[];
  if (!operations.length) return res.status(400).json({ error: "no_pending_operations" });

  // A confirmation is tied to the exact proposal, not merely the operation kind.
  const pending = Array.isArray(payload.needs_confirmation) ? payload.needs_confirmation : [];
  if (pending.length) {
    const pendingJson = new Set(pending.map((op: unknown) => JSON.stringify(op)));
    const approvedPending = operations.filter((op) => pendingJson.has(JSON.stringify(op)));
    if (approvedPending.length !== pending.length) {
      return res.status(409).json({ error: "proposal_mismatch", message: "The approval payload does not match the pending proposal." });
    }
  }

  let currentGraph: unknown = body.graph;
  const flowId = body.flowId ?? session.flow_id;
  if (flowId) {
    const flow = await queryOne<{ draft_definition: unknown }>(
      `SELECT draft_definition FROM flows WHERE id = $1 AND org_id = $2`,
      [flowId, req.orgId],
    );
    if (!flow) return res.status(404).json({ error: "flow_not_found" });
    currentGraph = flow.draft_definition;
  }
  if (!currentGraph) currentGraph = payload.graph ?? session.proposed_definition;
  if (!currentGraph) return res.status(409).json({ error: "no_current_graph" });

  // Re-run the complete applier with explicit approval. This rechecks catalog,
  // node/edge references and the resulting workflow before anything is saved.
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
  if (flowId) {
    await query(
      `UPDATE flows SET draft_definition = $3, updated_at = now(), updated_by = $4 WHERE id = $1 AND org_id = $2`,
      [flowId, req.orgId, JSON.stringify(definition), req.user!.userId],
    );
  }

  await query(
    `UPDATE copilot_sessions
        SET proposed_definition = $1, status = 'completed', stage = 'persist', updated_at = now()
      WHERE id = $2 AND org_id = $3`,
    [JSON.stringify(definition), session.id, req.orgId],
  );

  await query(
    `INSERT INTO audit_logs (org_id, actor_id, actor_kind, action, target_type, target_id, metadata)
     VALUES ($1, $2, 'user', 'copilot_approve', 'flow', $3, $4)`,
    [req.orgId, req.user!.userId, flowId ?? session.id, JSON.stringify({ sessionId: session.id, operations })],
  );

  res.json({
    ok: true,
    sessionId: session.id,
    flowId,
    graph: result.graph,
    definition,
    applied_operations: result.applied,
    rejected_operations: [],
    needs_confirmation: [],
    issues: result.issues,
    publishable: result.issues.length === 0,
  });
});
