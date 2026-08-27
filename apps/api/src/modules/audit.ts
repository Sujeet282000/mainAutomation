import { query } from "../db";

export async function writeAudit(opts: {
  organizationId?: string | null;
  workspaceId?: string | null;
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await query(
    `insert into audit_logs (organization_id, workspace_id, actor_id, action, target_type, target_id, ip, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      opts.organizationId ?? null,
      opts.workspaceId ?? null,
      opts.actorId ?? null,
      opts.action,
      opts.targetType ?? null,
      opts.targetId ?? null,
      opts.ip ?? null,
      JSON.stringify(opts.metadata ?? {})
    ]
  );
}
