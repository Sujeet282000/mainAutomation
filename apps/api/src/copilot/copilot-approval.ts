import { Router } from "express";
import { z } from "zod";
import { coerceWorkflowGraph } from "@algoverge/core";
import { query, queryOne } from "../db";
import { authMiddleware, orgMiddleware, requireRole } from "../auth";
import { applyAgentOperations } from "../agent-operation-applier";
import type { AgentOperation } from "../agent/operations";
import { persistBuilderDraft, loadBuilderGraph } from "../flow-runtime";

export const copilotApprovalRouter = Router();

const approveBody = z.object({
  flowId: z.string().uuid().optional(),
  name: z.string().min(1).max(120).optional(),
});

/**
 * Explicit approval boundary for Copilot proposals.
 * Approval never trusts operations supplied by the browser: the server takes
 * the exact operations it recorded when the plan was generated.
 *
 * Two flows share this endpoint:
 *  1. Plan → review → build (no existing workflow): the reviewed proposal is
 *     adopted and the workflow is created server-side from proposed_definition.
 *  2. Builder sessions (existing workflow): the recorded confirmation-gated
 *     operations are re-validated against the real catalog and current graph
 *     immediately before persistence.
 */
copilotApprovalRouter.post("/copilot/sessions/:id/approve", authMiddleware, orgMiddleware, requireRole("owner", "admin", "editor"), async (req, res) => {
  const body = approveBody.parse(req.body ?? {});
  const session = await queryOne<{
    id: string;
    org_id: string;
    flow_id: string | null;
    proposed_definition: unknown;
    pending_operations: unknown[] | null;
    status: string | null;
  }>(
    `SELECT id, org_id, flow_id, proposed_definition, pending_operations, status
       FROM copilot_sessions
      WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.orgId],
  );
  if (!session) return res.status(404).json({ error: "not_found" });
  if (session.status === "completed") return res.status(409).json({ error: "proposal_already_approved" });

  // ── Flow 1: adopt the reviewed proposal and create the workflow. ──
  // Sessions created by /ai/copilot/plan without an existing automation carry
  // the fully grounded, validated proposal. Applying pending operations again
  // would double them; instead the proposal itself becomes the new workflow.
  if (!session.flow_id && !body.flowId && session.proposed_definition) {
    let proposal;
    try {
      proposal = loadBuilderGraph(session.proposed_definition);
    } catch {
      return res.status(409).json({ error: "invalid_proposal" });
    }
    if (proposal.nodes.length > 0) {
      const { ensureProjectId } = await import("../copilot/copilot-http");
      const projectId = await ensureProjectId(req.orgId!);
      const name = body.name?.trim() || "Copilot draft";
      const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const created = await queryOne<{ id: string }>(
        `INSERT INTO flows (org_id, project_id, name, slug, origin, created_by, draft_definition)
         VALUES ($1, $2, $3, $4, 'copilot', $5, $6) RETURNING id`,
        [req.orgId, projectId, name, `${baseSlug || "copilot-draft"}-${Date.now().toString(36)}`, req.user!.userId, JSON.stringify(persistBuilderDraft(proposal))],
      );
      const flowId = created!.id;
      await query(
        `UPDATE copilot_sessions
            SET flow_id = $2, status = 'completed', pending_operations = NULL, stage = 'persist', updated_at = now()
          WHERE id = $1`,
        [session.id, flowId],
      );
      await query(
        `INSERT INTO audit_logs (org_id, actor_id, actor_kind, action, target_type, target_id, metadata)
         VALUES ($1, $2, 'user', 'copilot_approve', 'flow', $3, $4)`,
        [req.orgId, req.user!.userId, flowId, JSON.stringify({ sessionId: session.id, adoptedProposal: true, stepCount: proposal.nodes.length })],
      ).catch(() => undefined);

      return res.json({
        ok: true,
        sessionId: session.id,
        flowId,
        graph: proposal,
        definition: persistBuilderDraft(proposal),
        applied_operations: [],
        rejected_operations: [],
        needs_confirmation: [],
        issues: [],
      });
    }
  }

  // ── Flow 2: confirmation-gated operations on an existing workflow. ──
  // The exact server-recorded proposal is the only thing this endpoint can
  // approve. Prefer the copilot_events proposal log (builder sessions); fall
  // back to the session row for plan-endpoint sessions that carry grounded ops.
  const proposalEvent = await queryOne<{ payload: any }>(
    `SELECT payload
       FROM copilot_events
      WHERE session_id = $1 AND org_id = $2 AND event_type = 'proposal'
      ORDER BY sequence_no DESC
      LIMIT 1`,
    [session.id, req.orgId],
  );
  const payload = proposalEvent?.payload ?? {};
  let pending: unknown[] = Array.isArray(payload.needs_confirmation) ? payload.needs_confirmation : [];
  if (!pending.length && Array.isArray(session.pending_operations)) {
    pending = session.pending_operations;
  }
  if (!pending.length) {
    return res.status(409).json({ error: "no_pending_confirmation", message: "There are no confirmation-gated Copilot operations waiting for approval." });
  }

  const operations = pending as AgentOperation[];

  const requestedFlowId = body.flowId ?? session.flow_id;
  if (body.flowId && session.flow_id && body.flowId !== session.flow_id) {
    return res.status(409).json({ error: "flow_mismatch" });
  }
  if (!requestedFlowId) return res.status(409).json({ error: "no_current_graph" });

  const flow = await queryOne<{ draft_definition: unknown }>(
    `SELECT draft_definition FROM flows WHERE id = $1 AND org_id = $2`,
    [requestedFlowId, req.orgId],
  );
  if (!flow) return res.status(404).json({ error: "flow_not_found" });
  const currentGraph = flow.draft_definition;
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
  await query(
    `UPDATE flows SET draft_definition = $3, updated_at = now(), updated_by = $4 WHERE id = $1 AND org_id = $2`,
    [requestedFlowId, req.orgId, JSON.stringify(definition), req.user!.userId],
  );

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
