import { query, queryOne } from "./db";
import { createAndRunFlow } from "./flow-runtime";

// =============================================================================
// Product-surface event triggers (canonical).
//
// Fires when a form submission, table record change, or parsed email should
// trigger published automations. Lookup goes through triggers_registry — rows
// written by TriggerActivationService at publish time (piece_name='tables' /
// 'email-parser') — and dispatch goes through createAndRunFlow, the canonical
// durable path. The previous implementation queried the legacy
// automations/automation_versions tables AND selected a nonexistent
// workspace_id column on data_tables, so every form/table event silently
// failed (callers swallow errors with .catch(() => {})).
// =============================================================================

async function registeredTableTriggerFlows(orgId: string, operation: string) {
  const rows = await query<{ flow_id: string }>(
    `SELECT flow_id FROM triggers_registry
     WHERE org_id = $1 AND enabled = true AND status = 'active'
       AND piece_name = 'tables' AND operation_id = $2`,
    [orgId, operation],
  );
  return rows;
}

export async function fireTableRecordEvent(opts: {
  tableId: string;
  record: Record<string, unknown>;
  operation: "new_record" | "updated_record" | "deleted_record";
}) {
  const table = await queryOne<{ org_id: string }>(`select org_id from data_tables where id=$1`, [
    opts.tableId,
  ]);
  if (!table) return;
  const flows = await registeredTableTriggerFlows(table.org_id, opts.operation);
  for (const flow of flows) {
    // A trigger may pin a specific table; skip flows pointed at other tables.
    const pinned = await queryOne<{ table_id: string | null }>(
      `SELECT (SELECT definition->'trigger'->'props'->>'tableId' FROM flow_versions WHERE id = r.flow_version_id) AS table_id
       FROM triggers_registry r WHERE r.flow_id = $1 AND r.status = 'active' LIMIT 1`,
      [flow.flow_id],
    );
    if (pinned?.table_id && pinned.table_id !== opts.tableId) continue;
    await createAndRunFlow({
      orgId: table.org_id,
      flowId: flow.flow_id,
      userId: "system",
      triggerKind: "table_event",
      payload: { tableId: opts.tableId, _event: opts.operation, ...opts.record },
      idempotencyKey: `table:${opts.tableId}:${opts.operation}:${opts.record.id ?? ""}`,
    }).catch((err) => {
      const message = err instanceof Error ? err.message : "table_event_dispatch_failed";
      console.warn(`[events] table trigger ${flow.flow_id} dispatch failed: ${message}`);
    });
  }
}

export async function fireParserEmail(opts: { mailbox: string; subject: string; body: string; from?: string }) {
  const parser = await queryOne<{ id: string; organization_id: string; template: { fields?: Array<{ key: string; pattern?: string }> } }>(
    `select id, organization_id, template from email_parsers where mailbox=$1`,
    [opts.mailbox],
  );
  if (!parser) return null;
  const extracted: Record<string, string> = { subject: opts.subject, body: opts.body, from: opts.from ?? "" };
  for (const field of parser.template?.fields ?? []) {
    if (!field.pattern) continue;
    try {
      const m = opts.body.match(new RegExp(field.pattern, "i"));
      extracted[field.key] = m?.[1] ?? m?.[0] ?? "";
    } catch {
      extracted[field.key] = "";
    }
  }
  const flows = await query<{ flow_id: string }>(
    `SELECT flow_id FROM triggers_registry
     WHERE org_id = $1 AND enabled = true AND status = 'active'
       AND piece_name = 'email-parser' AND operation_id = 'new_email'`,
    [parser.organization_id],
  );
  for (const flow of flows) {
    await createAndRunFlow({
      orgId: parser.organization_id,
      flowId: flow.flow_id,
      userId: "system",
      triggerKind: "email_parser",
      payload: extracted,
    }).catch(() => {});
  }
  return extracted;
}
