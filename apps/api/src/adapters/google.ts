import { env } from "../config";
import { persistConnectionAuth } from "../persist";
import { authHeaders, requireOk } from "./http";
import { registerAdapter, registerDynamicFields } from "./registry";
import type { AdapterContext } from "./types";

function requireValue(input: Record<string, unknown>, key: string, label: string) {
  const v = input[key];
  if (v === undefined || v === null || String(v).trim() === "") {
    throw new Error(`${label} is required`);
  }
  return String(v);
}

function parseRow(values: unknown): unknown[] {
  if (Array.isArray(values)) return values;
  if (typeof values === "string") {
    try {
      const parsed = JSON.parse(values);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return values.split(",").map((s) => s.trim());
    }
  }
  throw new Error("values must be a JSON array (for example [\"Ada\",\"ada@example.com\"])");
}

async function googleToken(ctx: Pick<AdapterContext, "auth" | "connectionId" | "workspaceId">, forceRefresh = false) {
  const auth = ctx.auth;
  if (!auth) throw new Error("Google connection required. Connect Gmail, Sheets, or Calendar in Apps.");
  const fresh = auth.access_token && (!auth.expires_at || Date.now() < Number(auth.expires_at) - 30_000);
  if (!forceRefresh && fresh) return String(auth.access_token);
  const refresh = auth.refresh_token ? String(auth.refresh_token) : "";
  if (!refresh) {
    if (!forceRefresh && auth.access_token) return String(auth.access_token);
    throw new Error("Google OAuth tokens expired. Reconnect the app after setting GOOGLE_CLIENT_ID.");
  }
  if (!env.google.clientId || !env.google.clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set (see ENVIRONMENT.md).");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token"
    })
  });
  const json = await requireOk(res, "Google token refresh");
  if (!json.access_token) throw new Error("Google token refresh did not return access_token.");
  auth.access_token = String(json.access_token);
  auth.expires_at = Date.now() + Number(json.expires_in ?? 3600) * 1000;
  await persistConnectionAuth(ctx.connectionId, auth, ctx.workspaceId);
  return String(auth.access_token);
}

async function googleHeaders(ctx: AdapterContext, forceRefresh = false) {
  const token = await googleToken(ctx, forceRefresh);
  return { ...authHeaders({ access_token: token }), "content-type": "application/json" };
}

async function googleFetch(ctx: AdapterContext, url: string, init: RequestInit, label: string) {
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...(await googleHeaders(ctx)) } });
  if (res.status === 401 && ctx.auth?.refresh_token) {
    const retry = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...(await googleHeaders(ctx, true)) }
    });
    if (retry.status === 204) return { deleted: true };
    return requireOk(retry, label);
  }
  if (res.status === 204) return { deleted: true };
  return requireOk(res, label);
}

/** Verify a stored Google OAuth connection with a read-only Google API call. */
export async function testGoogleConnection(auth: Record<string, unknown>, connectionId?: string, workspaceId = "") {
  const output = await googleFetch(
    { auth, connectionId, workspaceId, input: {}, executionId: "connection-test", appSlug: "google-calendar", operation: "test" },
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
    { method: "GET" },
    "Google connection test"
  );
  return { calendars: Array.isArray(output.items) ? output.items.length : 0 };
}

registerAdapter("gmail", "new_email", async (ctx) => {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("q", String(ctx.input.query ?? ""));
  const listing = await googleFetch(ctx, url.toString(), { method: "GET" }, "Gmail poll");
  const messageId = String((listing.messages as Array<{ id?: string }> | undefined)?.[0]?.id ?? "");
  if (!messageId) return { output: {} };
  const message = await googleFetch(
    ctx,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
    { method: "GET" },
    "Gmail message"
  );
  const headers = (message.payload as { headers?: Array<{ name?: string; value?: string }> } | undefined)?.headers ?? [];
  const header = (name: string) => headers.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
  return {
    output: {
      id: String(message.id ?? messageId),
      threadId: String(message.threadId ?? ""),
      from: header("from"),
      subject: header("subject"),
      snippet: String(message.snippet ?? ""),
      receivedAt: String(message.internalDate ?? "")
    }
  };
});
registerAdapter("gmail", "send_email", async (ctx) => {
  const to = requireValue(ctx.input, "to", "To");
  const subject = requireValue(ctx.input, "subject", "Subject");
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${ctx.input.body ?? ""}`
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const output = await googleFetch(
    ctx,
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    { method: "POST", body: JSON.stringify({ raw }) },
    "Gmail send"
  );
  return { output };
});

registerAdapter("google-sheets", "new_row", async (ctx) => ({ output: ctx.input }));

async function appendSheetRow(ctx: AdapterContext) {
  const spreadsheetId = requireValue(ctx.input, "spreadsheetId", "Spreadsheet ID");
  const sheet = encodeURIComponent(String(ctx.input.sheet ?? "Sheet1"));
  const row = parseRow(ctx.input.values);
  const output = await googleFetch(
    ctx,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheet}:append?valueInputOption=USER_ENTERED`,
    { method: "POST", body: JSON.stringify({ values: [row] }) },
    "Sheets append"
  );
  return { output };
}

registerAdapter("google-sheets", "create_row", appendSheetRow);
registerAdapter("google-sheets", "append_row", appendSheetRow);

registerAdapter("google-sheets", "create_spreadsheet", async (ctx) => {
  const title = requireValue(ctx.input, "title", "Title");
  const sheet = String(ctx.input.sheet ?? "Sheet1");
  const output = await googleFetch(
    ctx,
    "https://sheets.googleapis.com/v4/spreadsheets",
    {
      method: "POST",
      body: JSON.stringify({
        properties: { title },
        sheets: [{ properties: { title: sheet } }]
      })
    },
    "Sheets create spreadsheet"
  );
  return { output };
});

registerAdapter("google-sheets", "read_sheet", async (ctx) => {
  const spreadsheetId = requireValue(ctx.input, "spreadsheetId", "Spreadsheet ID");
  const sheet = encodeURIComponent(String(ctx.input.sheet ?? "Sheet1"));
  const body = await googleFetch(
    ctx,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheet}`,
    { method: "GET" },
    "Sheets read"
  );
  const values = (body.values as unknown[][] | undefined) ?? [];
  return { output: { ...body, values, rows: values.length } };
});

registerAdapter("google-sheets", "update_row", async (ctx) => {
  const spreadsheetId = requireValue(ctx.input, "spreadsheetId", "Spreadsheet ID");
  const sheet = String(ctx.input.sheet ?? "Sheet1");
  const row = requireValue(ctx.input, "row", "Row number");
  const values = parseRow(ctx.input.values);
  const range = encodeURIComponent(`${sheet}!A${row}`);
  const output = await googleFetch(
    ctx,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [values] }) },
    "Sheets update row"
  );
  return { output };
});

registerAdapter("google-sheets", "clear_row", async (ctx) => {
  const spreadsheetId = requireValue(ctx.input, "spreadsheetId", "Spreadsheet");
  const sheet = String(ctx.input.sheet ?? "Sheet1");
  const row = requireValue(ctx.input, "row", "Row(s)");
  const range = encodeURIComponent(`${sheet}!${row}:${row}`);
  const output = await googleFetch(
    ctx,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:clear`,
    { method: "POST", body: "{}" },
    "Sheets clear row"
  );
  return { output };
});

registerAdapter("google-sheets", "find_row", async (ctx) => {
  const spreadsheetId = requireValue(ctx.input, "spreadsheetId", "Spreadsheet ID");
  const sheet = encodeURIComponent(String(ctx.input.sheet ?? "Sheet1"));
  const q = String(ctx.input.query ?? "");
  const body = await googleFetch(
    ctx,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheet}`,
    { method: "GET" },
    "Sheets find"
  );
  const rows = (body.values as unknown[][] | undefined) ?? [];
  const index = rows.findIndex((r) => r.some((cell) => String(cell).toLowerCase().includes(q.toLowerCase())));
  return { output: { row: index >= 0 ? rows[index] : null, matched: index >= 0, rowNumber: index >= 0 ? index + 1 : null } };
});

registerAdapter("google-calendar", "new_event", async (ctx) => {
  const calendarId = encodeURIComponent(String(ctx.input.calendarId ?? "primary"));
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "updated");
  url.searchParams.set("maxResults", "25");
  const updatedMin = String(ctx.input.updatedMin ?? ctx.input.cursor ?? "");
  if (updatedMin) url.searchParams.set("updatedMin", updatedMin);
  else url.searchParams.set("timeMin", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  const body = await googleFetch(ctx, url.toString(), { method: "GET" }, "Calendar poll");
  const items = ((body.items as Record<string, unknown>[] | undefined) ?? []).filter((e) => e.status !== "cancelled");
  const newest = items[items.length - 1] ?? items[0];
  return {
    output: newest
      ? {
          id: newest.id,
          summary: newest.summary,
          start: (newest.start as { dateTime?: string; date?: string } | undefined)?.dateTime ??
            (newest.start as { date?: string } | undefined)?.date,
          end: (newest.end as { dateTime?: string; date?: string } | undefined)?.dateTime ??
            (newest.end as { date?: string } | undefined)?.date,
          htmlLink: newest.htmlLink,
          status: newest.status,
          updated: newest.updated,
          organizer: newest.organizer,
          items
        }
      : { items: [], id: null }
  };
});

registerAdapter("google-calendar", "create_event", async (ctx) => {
  const calendarId = encodeURIComponent(String(ctx.input.calendarId ?? "primary"));
  const summary = requireValue(ctx.input, "summary", "Title");
  const start = requireValue(ctx.input, "start", "Start");
  const end = requireValue(ctx.input, "end", "End");
  const output = await googleFetch(
    ctx,
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
    {
      method: "POST",
      body: JSON.stringify({
        summary,
        start: { dateTime: start, timeZone: "UTC" },
        end: { dateTime: end, timeZone: "UTC" }
      })
    },
    "Calendar create"
  );
  return { output };
});

registerAdapter("google-calendar", "list_events", async (ctx) => {
  const calendarId = encodeURIComponent(String(ctx.input.calendarId ?? "primary"));
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(ctx.input.maxResults ?? 10));
  if (ctx.input.timeMin) url.searchParams.set("timeMin", String(ctx.input.timeMin));
  if (ctx.input.timeMax) url.searchParams.set("timeMax", String(ctx.input.timeMax));
  const output = await googleFetch(ctx, url.toString(), { method: "GET" }, "Calendar list");
  return { output };
});

registerAdapter("google-calendar", "update_event", async (ctx) => {
  const calendarId = encodeURIComponent(String(ctx.input.calendarId ?? "primary"));
  const eventId = encodeURIComponent(requireValue(ctx.input, "eventId", "Event ID"));
  const patch: Record<string, unknown> = {};
  if (ctx.input.summary) patch.summary = ctx.input.summary;
  if (ctx.input.start) patch.start = { dateTime: ctx.input.start, timeZone: "UTC" };
  if (ctx.input.end) patch.end = { dateTime: ctx.input.end, timeZone: "UTC" };
  const output = await googleFetch(
    ctx,
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`,
    { method: "PATCH", body: JSON.stringify(patch) },
    "Calendar update"
  );
  return { output };
});

registerAdapter("google-calendar", "delete_event", async (ctx) => {
  const calendarId = encodeURIComponent(String(ctx.input.calendarId ?? "primary"));
  const eventId = encodeURIComponent(requireValue(ctx.input, "eventId", "Event ID"));
  const output = await googleFetch(
    ctx,
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`,
    { method: "DELETE" },
    "Calendar delete"
  );
  return { output: { ...output, id: ctx.input.eventId, deleted: true } };
});

registerAdapter("google-drive", "new_file", async (ctx) => ({ output: ctx.input }));
registerAdapter("google-drive", "upload_file", async (ctx) => {
  const metadata = { name: String(ctx.input.name ?? "file.txt"), mimeType: "text/plain" };
  const boundary = "algoverge";
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/plain\r\n\r\n${String(ctx.input.content ?? "")}\r\n--${boundary}--`;
  const token = await googleToken(ctx);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` },
    body
  });
  return { output: await requireOk(res, "Drive upload") };
});

export async function googleDynamicFields(opts: {
  operation: string;
  auth: Record<string, unknown> | null;
  input: Record<string, unknown>;
  query?: string;
  cursor?: string;
}) {
  const q = (opts.query ?? "").trim().toLowerCase();
  const sheetOps = new Set(["create_row", "append_row", "find_row", "new_row", "read_sheet", "update_row", "clear_row"]);
  if (sheetOps.has(opts.operation)) {
    const driveOptions = [
      { label: "My Google Drive", value: "my-drive" },
      { label: "Shared drives", value: "shared" }
    ].filter((o) => !q || o.label.toLowerCase().includes(q));
    const driveField = { key: "drive", label: "Drive", type: "select" as const, options: driveOptions };
    if (!opts.auth) {
      return [
        driveField,
        { key: "spreadsheetId", label: "Spreadsheet", type: "dynamic" as const, options: [] as { label: string; value: string }[] },
        { key: "sheet", label: "Worksheet", type: "dynamic" as const, options: [] as { label: string; value: string }[] }
      ];
    }
    const token = await googleToken({ auth: opts.auth, connectionId: undefined, workspaceId: "" });
    const search = q ? ` and name contains '${q.replace(/'/g, "\\'")}'` : "";
    const list = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false${search}`
      )}&pageSize=25&fields=files(id,name),nextPageToken&pageToken=${encodeURIComponent(opts.cursor ?? "")}`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    let files: { id?: string; name?: string }[] = [];
    if (list.ok) {
      const body = (await list.json()) as { files?: { id?: string; name?: string }[] };
      files = body.files ?? [];
    }
    const spreadsheetOptions = files.map((f) => ({
      label: f.name || "Untitled spreadsheet",
      value: f.id || "",
      hint: f.id
    }));
    const spreadsheetId = String(opts.input.spreadsheetId ?? "");
    let sheetOptions: { label: string; value: string; hint?: string }[] = [];
    if (spreadsheetId) {
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(title,sheetId)`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const body = await requireOk(res, "Sheets metadata");
        sheetOptions = ((body.sheets as { properties?: { title?: string; sheetId?: number } }[]) ?? [])
          .map((s) => ({
            label: s.properties?.title || "Sheet",
            value: s.properties?.title || "Sheet1",
            hint: `ID: ${s.properties?.sheetId ?? 0}`
          }))
          .filter((o) => !q || o.label.toLowerCase().includes(q));
      }
    }
    return [
      driveField,
      { key: "spreadsheetId", label: "Spreadsheet", type: "dynamic" as const, options: spreadsheetOptions.filter((o) => o.value) },
      { key: "sheet", label: "Worksheet", type: "dynamic" as const, options: sheetOptions }
    ];
  }

  const calendarOps = new Set(["new_event", "create_event", "list_events", "update_event", "delete_event", "add_attendee"]);
  if (calendarOps.has(opts.operation) && opts.auth) {
    const token = await googleToken({ auth: opts.auth, connectionId: undefined, workspaceId: "" });
    const calRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
      headers: { authorization: `Bearer ${token}` }
    });
    const calBody = await requireOk(calRes, "Calendar list");
    const calendars = ((calBody.items as { id?: string; summary?: string }[]) ?? [])
      .map((c) => ({
        label: c.summary || c.id || "calendar",
        value: c.id || "primary",
        hint: c.id
      }))
      .filter((o) => !q || o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q));
    const fields: Array<{
      key: string;
      label: string;
      type: "select";
      options: { label: string; value: string; hint?: string }[];
    }> = [{ key: "calendarId", label: "Calendar", type: "select", options: calendars.length ? calendars : [{ label: "Primary", value: "primary" }] }];
    if (opts.operation === "update_event" || opts.operation === "delete_event" || opts.operation === "add_attendee") {
      const calendarId = encodeURIComponent(String(opts.input.calendarId ?? "primary"));
      const evRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?singleEvents=true&orderBy=startTime&maxResults=25&timeMin=${encodeURIComponent(new Date().toISOString())}`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      const evBody = await requireOk(evRes, "Calendar events");
      const events = ((evBody.items as { id?: string; summary?: string; start?: { dateTime?: string; date?: string } }[]) ?? []).map(
        (e) => ({
          label: `${e.summary || "(no title)"} · ${e.start?.dateTime ?? e.start?.date ?? ""}`,
          value: e.id || "",
          hint: e.id
        })
      );
      fields.push({
        key: "eventId",
        label: "Event",
        type: "select",
        options: events.filter((e) => e.value && (!q || e.label.toLowerCase().includes(q)))
      });
    }
    return fields;
  }
  return [];
}

registerDynamicFields("google-sheets", googleDynamicFields);
registerDynamicFields("gmail", googleDynamicFields);
registerDynamicFields("google-calendar", googleDynamicFields);
registerDynamicFields("google-drive", googleDynamicFields);
