import { env } from "../config";
import { query, queryOne } from "../db";
import { registerAdapter } from "./registry";

registerAdapter("digest", "add", async ({ input, workspaceId }) => {
  const key = String(input.digestKey ?? "default");
  await query(`insert into digest_items (workspace_id, digest_key, item) values ($1,$2,$3)`, [
    workspaceId,
    key,
    JSON.stringify(input.item ?? input)
  ]);
  const count = await queryOne<{ n: string }>(
    `select count(*)::text as n from digest_items where workspace_id=$1 and digest_key=$2`,
    [workspaceId, key]
  );
  return { output: { count: Number(count?.n ?? 0), digestKey: key } };
});

registerAdapter("digest", "release", async ({ input, workspaceId }) => {
  const key = String(input.digestKey ?? "default");
  const items = await query(`select item from digest_items where workspace_id=$1 and digest_key=$2 order by created_at`, [
    workspaceId,
    key
  ]);
  await query(`delete from digest_items where workspace_id=$1 and digest_key=$2`, [workspaceId, key]);
  return { output: { items: items.map((r) => r.item), count: items.length, digestKey: key } };
});

registerAdapter("storage", "set", async ({ input, workspaceId }) => {
  await query(
    `insert into workspace_kv (workspace_id, key, value) values ($1,$2,$3)
     on conflict (workspace_id, key) do update set value=excluded.value, updated_at=now()`,
    [workspaceId, String(input.key), JSON.stringify(input.value ?? null)]
  );
  return { output: { key: input.key, stored: true } };
});

registerAdapter("storage", "get", async ({ input, workspaceId }) => {
  const row = await queryOne<{ value: unknown }>(`select value from workspace_kv where workspace_id=$1 and key=$2`, [
    workspaceId,
    String(input.key)
  ]);
  return { output: { key: input.key, value: row?.value ?? null } };
});

registerAdapter("variables", "get", async ({ input, workspaceId }) => {
  const row = await queryOne<{ value: string }>(`select value from workspace_variables where workspace_id=$1 and key=$2`, [
    workspaceId,
    String(input.key)
  ]);
  return { output: { key: input.key, value: row?.value ?? null } };
});

function extractEmails(raw: unknown): string[] {
  const text = String(raw ?? "");
  const found = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(found.map((s) => s.trim()))];
}

registerAdapter("email", "send", async ({ input, auth }) => {
  const key = String(auth?.api_key ?? env.resend ?? "");
  if (!key) throw new Error("Email API key missing on the connection (or RESEND_API_KEY).");
  const to = extractEmails(input.to);
  if (!to.length) {
    throw new Error(
      `Email "To" is not a valid address (got "${String(input.to ?? "")}"). Map one email field, or type an address — do not glue {{fields}} onto the address.`
    );
  }
  let from = String(input.from ?? env.emailFrom);
  if (/@algoverge\.local\b|@localhost\b/i.test(from)) {
    from = "Algoverge <beth.t@example.com>";
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: String(input.subject),
      html: String(input.body ?? "")
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      typeof body === "object" && body && "message" in body
        ? String((body as { message?: string }).message)
        : JSON.stringify(body);
    throw new Error(`Email send failed (${res.status}): ${detail || "invalid from/to or unverified domain"}`);
  }
  return { output: body as Record<string, unknown> };
});

registerAdapter("manager", "run_ended", async ({ input }) => ({ output: input }));
registerAdapter("manager", "turn_off", async ({ input, workspaceId }) => {
  await query(`update automations set status='off', updated_at=now() where id=$1 and workspace_id=$2`, [
    input.automationId,
    workspaceId
  ]);
  return { output: { automationId: input.automationId, status: "off" } };
});

registerAdapter("tables", "update_record", async ({ input, workspaceId }) => {
  const row = await queryOne(
    `update data_table_rows set data=$2, updated_at=now() where id=$1 and org_id=$3 returning *`,
    [input.recordId, JSON.stringify(input.data ?? {}), workspaceId]
  );
  return { output: row ?? {} };
});

registerAdapter("tables", "delete_record", async ({ input, workspaceId }) => {
  await query(`delete from data_table_rows where id=$1 and org_id=$2`, [input.recordId, workspaceId]);
  return { output: { deleted: true, id: input.recordId } };
});

registerAdapter("email-parser", "new_email", async ({ input }) => ({ output: input }));
registerAdapter("email-parser", "parse", async ({ input }) => {
  const text = String(input.text ?? "");
  const pattern = String(input.pattern ?? "(.+)");
  let captured = "";
  try {
    captured = text.match(new RegExp(pattern, "i"))?.[1] ?? text.match(new RegExp(pattern, "i"))?.[0] ?? "";
  } catch {
    captured = "";
  }
  return { output: { captured, text } };
});
registerAdapter("ai-guardrails", "screen", async ({ input }) => {
  const text = String(input.text ?? "");
  const blocked = /\b(ssn|credit card|password)\b/i.test(text);
  if (blocked) return { output: { allowed: false, reason: "policy" }, control: "skip_rest" };
  return { output: { allowed: true, text } };
});
registerAdapter("transfer", "run", async ({ input }) => {
  const src = String(input.sourceTableId ?? input.source ?? "");
  const dest = String(input.destTableId ?? input.destination ?? "");
  if (!src || !dest) throw new Error("sourceTableId and destTableId are required");
  const rows = await query<{ data: Record<string, unknown> }>(`select data from table_records where table_id=$1`, [src]);
  for (const row of rows) {
    await query(`insert into table_records (table_id, data) values ($1,$2)`, [dest, JSON.stringify(row.data)]);
  }
  return { output: { copied: rows.length } };
});
