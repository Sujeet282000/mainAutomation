import { createExecution, findPublishedByTrigger } from "./engine";
import { query, queryOne } from "./db";

export async function fireTableRecordEvent(opts: {
  tableId: string;
  record: Record<string, unknown>;
  operation: "new_record" | "updated_record" | "deleted_record";
}) {
  const table = await queryOne<{ workspace_id: string }>(`select workspace_id from data_tables where id=$1`, [
    opts.tableId
  ]);
  if (!table) return;
  const published = await findPublishedByTrigger("tables", opts.operation === "new_record" ? "new_record" : opts.operation);
  for (const auto of published) {
    if (auto.workspace_id !== table.workspace_id) continue;
    const version = await queryOne<{ graph: { nodes?: Array<{ type?: string; appSlug?: string; config?: { tableId?: string } }> } }>(
      `select v.graph from automations a join automation_versions v on v.id=a.published_version_id where a.id=$1`,
      [auto.id]
    );
    const trigger = version?.graph?.nodes?.find((n) => n.type === "trigger" && n.appSlug === "tables");
    const configured = trigger?.config?.tableId;
    if (configured && configured !== opts.tableId) continue;
    await createExecution({
      automationId: auto.id,
      triggerType: "table",
      triggerData: { tableId: opts.tableId, ...opts.record, _event: opts.operation }
    });
  }
}

export async function fireParserEmail(opts: { mailbox: string; subject: string; body: string; from?: string }) {
  const parser = await queryOne<{ id: string; workspace_id: string; template: { fields?: Array<{ key: string; pattern?: string }> } }>(
    `select id, workspace_id, template from email_parsers where mailbox=$1`,
    [opts.mailbox]
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
  const published = await findPublishedByTrigger("email-parser", "new_email");
  for (const auto of published) {
    if (auto.workspace_id !== parser.workspace_id) continue;
    await createExecution({
      automationId: auto.id,
      triggerType: "email_parser",
      triggerData: extracted
    });
  }
  return extracted;
}
