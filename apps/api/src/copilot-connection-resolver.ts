// =============================================================================
// ConnectionResolver — Resolves connections for plan steps using workspace context
// Priority: exact account match → workspace default → recently used → most used → needs attention
// =============================================================================

import { query } from "./db";
import { pickForCopilot } from "./connections";
import type { AutomationPlan, PlanConnection } from "@algoverge/shared";

type ConnectionRow = {
  id: string;
  piece_name: string;
  status: string;
  workspace_id: string;
  label: string | null;
  last_used_at: string | null;
};

/**
 * Resolve connections for all steps in an AutomationPlan.
 * Mutates plan.connections in place and returns attention items for unresolvable connections.
 */
export async function resolveConnections(opts: {
  plan: AutomationPlan;
  workspaceId: string;
  userEmail: string | null;
}): Promise<{
  resolved: PlanConnection[];
  needsAttention: Array<{ appSlug: string; message: string }>;
}> {
  const { plan, workspaceId, userEmail } = opts;
  const needsAttention: Array<{ appSlug: string; message: string }> = [];
  const resolved: PlanConnection[] = [];

  // Collect unique app slugs that need connections
  const appSlugsNeedingConnection = new Set<string>();
  for (const step of plan.steps) {
    if (step.connectionRequired && step.appSlug) {
      appSlugsNeedingConnection.add(step.appSlug);
    }
  }

  for (const appSlug of appSlugsNeedingConnection) {
    // Query existing connections for this workspace + app
    const connections = await query<ConnectionRow>(
      `SELECT id, piece_name, status, workspace_id, label, last_used_at
       FROM connections
       WHERE piece_name = $1 AND workspace_id = $2 AND status = 'active'
       ORDER BY last_used_at DESC NULLS LAST, created_at DESC`,
      [appSlug, workspaceId]
    );

    if (connections.length === 0) {
      // No connections — needs user attention
      needsAttention.push({
        appSlug,
        message: `Connect your ${appSlug} account — no existing connections found.`,
      });
      resolved.push({
        appSlug,
        appName: appSlug,
        connectionId: null,
        status: "not_configured",
        message: `No ${appSlug} connection available.`,
      });
    } else if (connections.length === 1) {
      // Only one connection — auto-select
      resolved.push({
        appSlug,
        appName: appSlug,
        connectionId: connections[0].id,
        status: "connected",
        accountEmail: connections[0].label ?? undefined,
      });
    } else {
      // Multiple connections — try email match first, then most recent
      let best = connections[0];
      if (userEmail) {
        const emailMatch = connections.find(
          (c) => c.label?.toLowerCase().includes(userEmail.toLowerCase())
        );
        if (emailMatch) best = emailMatch;
      }
      resolved.push({
        appSlug,
        appName: appSlug,
        connectionId: best.id,
        status: "connected",
        accountEmail: best.label ?? undefined,
        message: connections.length > 1
          ? `Selected best match from ${connections.length} connections.`
          : undefined,
      });
    }
  }

  // Apply resolved connections to plan steps
  for (const step of plan.steps) {
    if (!step.connectionRequired || !step.appSlug) continue;
    const resolvedConn = resolved.find((r) => r.appSlug === step.appSlug);
    if (resolvedConn?.connectionId) {
      step.connectionId = resolvedConn.connectionId;
    }
  }

  return { resolved, needsAttention };
}

/**
 * Pick the best connection for a single app, using workspace context.
 */
export async function pickBestConnection(opts: {
  workspaceId: string;
  appSlug: string;
  userEmail: string | null;
}): Promise<string | null> {
  const result = await pickForCopilot({
    workspaceId: opts.workspaceId,
    pieceName: opts.appSlug,
    userEmail: opts.userEmail,
  });
  return result.connectionId;
}
