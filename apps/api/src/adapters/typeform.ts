import { authHeaders, requireOk } from "./http";
import { registerAdapter, registerDynamicFields } from "./registry";

function tfAuth(auth: Record<string, unknown> | null): string {
  const token = String(auth?.access_token ?? auth?.api_key ?? "");
  if (!token) throw new Error("Typeform API token required. Connect your Typeform account in Apps.");
  return token;
}

function tfHeaders(auth: Record<string, unknown> | null) {
  return { authorization: `Bearer ${tfAuth(auth)}`, "content-type": "application/json" };
}

// ── Triggers ────────────────────────────────────────────────────────────

registerAdapter("typeform", "new_entry", async (ctx) => ({ output: ctx.input }));

registerAdapter("typeform", "new_submission", async (ctx) => {
  const token = tfAuth(ctx.auth);
  const formId = String(ctx.input.formId ?? "");
  if (!formId) throw new Error("Form ID is required.");

  const url = new URL(`https://api.typeform.com/forms/${formId}/responses`);
  url.searchParams.set("page_size", "1");
  url.searchParams.set("sort", "submitted_at,desc");

  const res = await fetch(url.toString(), { headers: tfHeaders(ctx.auth) });
  const body = await requireOk(res, "Typeform submissions");

  const items = (body.items as Record<string, unknown>[] | undefined) ?? [];
  const latest = items[0];
  if (!latest) return { output: {} };

  // Flatten answers into a key-value map
  const answers = (latest.answers as Record<string, unknown>[] | undefined) ?? [];
  const fields: Record<string, unknown> = {};
  for (const a of answers) {
    const fieldId = String(a.field?.ref ?? a.field?.id ?? "");
    const fieldTitle = String(a.field?.title ?? fieldId);
    fields[fieldId] = a.text ?? a.number ?? a.boolean ?? a.email ?? a.date ?? "";
    fields[fieldTitle] = fields[fieldId]; // Also store by title for easier mapping
  }

  return {
    output: {
      responseId: latest.response_id,
      submittedAt: latest.submitted_at,
      landedAt: latest.landed_at,
      formId,
      answers: fields,
      metadata: latest.metadata,
    }
  };
});

// ── Actions ─────────────────────────────────────────────────────────────

registerAdapter("typeform", "list_forms", async (ctx) => {
  const res = await fetch("https://api.typeform.com/forms?page_size=200", {
    headers: tfHeaders(ctx.auth),
  });
  const body = await requireOk(res, "Typeform forms");
  const forms = (body.items as Record<string, unknown>[] | undefined) ?? [];
  return {
    output: {
      forms: forms.map((f) => ({
        id: f.id,
        title: f.title,
        theme: (f.theme as Record<string, unknown>)?.href,
        created_at: f.created_at,
        last_modified_at: f.last_modified_at,
        settings: f.settings,
      })),
      total: body.total_items ?? forms.length,
    }
  };
});

registerAdapter("typeform", "get_form", async (ctx) => {
  const formId = String(ctx.input.formId ?? "");
  if (!formId) throw new Error("Form ID is required.");
  const res = await fetch(`https://api.typeform.com/forms/${formId}`, {
    headers: tfHeaders(ctx.auth),
  });
  return { output: await requireOk(res, "Typeform form") };
});

registerAdapter("typeform", "get_responses", async (ctx) => {
  const formId = String(ctx.input.formId ?? "");
  if (!formId) throw new Error("Form ID is required.");
  const pageSize = Math.min(Number(ctx.input.pageSize ?? 20), 1000);

  const url = new URL(`https://api.typeform.com/forms/${formId}/responses`);
  url.searchParams.set("page_size", String(pageSize));
  if (ctx.input.before) url.searchParams.set("before", String(ctx.input.before));
  if (ctx.input.after) url.searchParams.set("after", String(ctx.input.after));

  const res = await fetch(url.toString(), { headers: tfHeaders(ctx.auth) });
  const body = await requireOk(res, "Typeform responses");

  const items = (body.items as Record<string, unknown>[] | undefined) ?? [];
  const responses = items.map((r) => {
    const answers = (r.answers as Record<string, unknown>[] | undefined) ?? [];
    const fields: Record<string, unknown> = {};
    for (const a of answers) {
      const ref = String(a.field?.ref ?? a.field?.id ?? "");
      const title = String(a.field?.title ?? ref);
      fields[ref] = a.text ?? a.number ?? a.boolean ?? a.email ?? a.date ?? "";
      fields[title] = fields[ref];
    }
    return {
      responseId: r.response_id,
      submittedAt: r.submitted_at,
      landedAt: r.landed_at,
      answers: fields,
      metadata: r.metadata,
    };
  });

  return {
    output: {
      responses,
      total: body.total_items ?? 0,
      hasMore: body.items?.length === pageSize,
    }
  };
});

registerAdapter("typeform", "create_form", async (ctx) => {
  const title = String(ctx.input.title ?? "Untitled Form");
  const fields = (ctx.input.fields as Array<{ title: string; type: string }> | undefined) ?? [];

  const body = {
    title,
    fields: fields.map((f) => ({
      title: f.title,
      type: f.type ?? "short_text",
      validations: { required: false },
    })),
  };

  const res = await fetch("https://api.typeform.com/forms", {
    method: "POST",
    headers: tfHeaders(ctx.auth),
    body: JSON.stringify(body),
  });
  return { output: await requireOk(res, "Typeform create form") };
});

// ── Dynamic Fields ──────────────────────────────────────────────────────

registerDynamicFields("typeform", async ({ auth }) => {
  if (!auth) return [{ key: "formId", label: "Form", type: "string" as const }];

  const token = String(auth.access_token ?? auth.api_key ?? "");
  if (!token) return [{ key: "formId", label: "Form", type: "string" as const }];

  const res = await fetch("https://api.typeform.com/forms?page_size=200", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });

  if (!res.ok) return [{ key: "formId", label: "Form", type: "string" as const }];

  const body = await res.json() as { items?: Array<{ id?: string; title?: string }> };
  const forms = (body.items ?? []).filter((f) => f.id);

  return [
    {
      key: "formId",
      label: "Form",
      type: "select" as const,
      options: forms.map((f) => ({
        label: f.title || "Untitled",
        value: String(f.id),
        hint: f.id,
      })),
    },
  ];
});
