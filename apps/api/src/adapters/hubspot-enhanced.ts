import { authHeaders, requireOk } from "./http";
import { registerAdapter, registerDynamicFields } from "./registry";

// ── Existing adapters (already in apps.ts, but we enhance with more ops) ──

registerAdapter("hubspot", "new_deal", async (ctx) => ({ output: ctx.input }));

registerAdapter("hubspot", "create_deal", async (ctx) => {
  const properties: Record<string, string> = {};
  if (ctx.input.dealname) properties.dealname = String(ctx.input.dealname);
  if (ctx.input.amount) properties.amount = String(ctx.input.amount);
  if (ctx.input.dealstage) properties.dealstage = String(ctx.input.dealstage);
  if (ctx.input.pipeline) properties.pipeline = String(ctx.input.pipeline);
  if (ctx.input.closedate) properties.closedate = String(ctx.input.closedate);
  if (ctx.input.description) properties.description = String(ctx.input.description);

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals", {
    method: "POST",
    headers: { ...authHeaders(ctx.auth), "content-type": "application/json" },
    body: JSON.stringify({ properties }),
  });
  return { output: await requireOk(res, "HubSpot deal") };
});

registerAdapter("hubspot", "update_deal", async (ctx) => {
  const dealId = String(ctx.input.dealId ?? "");
  if (!dealId) throw new Error("Deal ID is required.");
  const properties: Record<string, string> = {};
  if (ctx.input.dealname) properties.dealname = String(ctx.input.dealname);
  if (ctx.input.amount) properties.amount = String(ctx.input.amount);
  if (ctx.input.dealstage) properties.dealstage = String(ctx.input.dealstage);
  if (ctx.input.description) properties.description = String(ctx.input.description);

  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
    method: "PATCH",
    headers: { ...authHeaders(ctx.auth), "content-type": "application/json" },
    body: JSON.stringify({ properties }),
  });
  return { output: await requireOk(res, "HubSpot deal update") };
});

registerAdapter("hubspot", "new_company", async (ctx) => ({ output: ctx.input }));

registerAdapter("hubspot", "create_company", async (ctx) => {
  const properties: Record<string, string> = {};
  if (ctx.input.name) properties.name = String(ctx.input.name);
  if (ctx.input.domain) properties.domain = String(ctx.input.domain);
  if (ctx.input.industry) properties.industry = String(ctx.input.industry);
  if (ctx.input.phone) properties.phone = String(ctx.input.phone);
  if (ctx.input.address) properties.address = String(ctx.input.address);

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies", {
    method: "POST",
    headers: { ...authHeaders(ctx.auth), "content-type": "application/json" },
    body: JSON.stringify({ properties }),
  });
  return { output: await requireOk(res, "HubSpot company") };
});

registerAdapter("hubspot", "new_ticket", async (ctx) => ({ output: ctx.input }));

registerAdapter("hubspot", "create_ticket", async (ctx) => {
  const properties: Record<string, string> = {};
  if (ctx.input.subject) properties.subject = String(ctx.input.subject);
  if (ctx.input.content) properties.content = String(ctx.input.content);
  if (ctx.input.pipeline) properties.hs_pipeline = String(ctx.input.pipeline);
  if (ctx.input.priority) properties.hs_ticket_priority = String(ctx.input.priority);
  if (ctx.input.source) properties.hs_ticket_source = String(ctx.input.source);

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/tickets", {
    method: "POST",
    headers: { ...authHeaders(ctx.auth), "content-type": "application/json" },
    body: JSON.stringify({ properties }),
  });
  return { output: await requireOk(res, "HubSpot ticket") };
});

registerAdapter("hubspot", "list_contacts", async (ctx) => {
  const limit = Math.min(Number(ctx.input.limit ?? 10), 100);
  const url = new URL("https://api.hubapi.com/crm/v3/objects/contacts");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("properties", "email,firstname,lastname,phone,company");

  const res = await fetch(url.toString(), { headers: authHeaders(ctx.auth) });
  const body = await requireOk(res, "HubSpot contacts list");
  return { output: body };
});

registerAdapter("hubspot", "search_contacts", async (ctx) => {
  const query = String(ctx.input.query ?? "");
  if (!query) throw new Error("Search query is required.");

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
    method: "POST",
    headers: { ...authHeaders(ctx.auth), "content-type": "application/json" },
    body: JSON.stringify({
      query,
      limit: 10,
      properties: ["email", "firstname", "lastname", "phone", "company"],
    }),
  });
  return { output: await requireOk(res, "HubSpot contact search") };
});

// ── Dynamic Fields ──────────────────────────────────────────────────────

registerDynamicFields("hubspot", async ({ auth, operation }) => {
  if (!auth) return [];

  // Deal-related fields
  if (["create_deal", "update_deal", "new_deal"].includes(operation)) {
    const pipelineFields = [{
      key: "dealstage",
      label: "Stage",
      type: "select" as const,
      options: [
        { label: "Appointment Scheduled", value: "appointmentscheduled" },
        { label: "Qualified to Buy", value: "qualifiedtobuy" },
        { label: "Presentation Scheduled", value: "presentationscheduled" },
        { label: "Decision Maker Bought-In", value: "decisionmakerboughtin" },
        { label: "Contract Sent", value: "contractsent" },
        { label: "Closed Won", value: "closedwon" },
        { label: "Closed Lost", value: "closedlost" },
      ],
    }];

    if (operation === "update_deal") {
      // Fetch existing deals for selection
      try {
        const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals?limit=100&properties=dealname,amount,dealstage", {
          headers: authHeaders(auth),
        });
        if (res.ok) {
          const body = await res.json() as { results?: Array<{ id?: string; properties?: Record<string, string> }> };
          const deals = (body.results ?? []).filter((d) => d.id);
          pipelineFields.unshift({
            key: "dealId",
            label: "Deal",
            type: "select" as const,
            options: deals.map((d) => ({
              label: `${d.properties?.dealname ?? "Untitled"} ${d.properties?.amount ? `($${d.properties.amount})` : ""}`,
              value: String(d.id),
              hint: d.properties?.dealstage,
            })),
          });
        }
      } catch { /* fallback */ }
    }

    return pipelineFields;
  }

  // Ticket fields
  if (["create_ticket", "new_ticket"].includes(operation)) {
    return [{
      key: "pipeline",
      label: "Pipeline",
      type: "select" as const,
      options: [
        { label: "Support", value: "0" },
        { label: "Service", value: "1" },
      ],
    }, {
      key: "priority",
      label: "Priority",
      type: "select" as const,
      options: [
        { label: "Low", value: "LOW" },
        { label: "Medium", value: "MEDIUM" },
        { label: "High", value: "HIGH" },
      ],
    }, {
      key: "source",
      label: "Source",
      type: "select" as const,
      options: [
        { label: "Email", value: "EMAIL" },
        { label: "Chat", value: "CHAT" },
        { label: "Form", value: "FORM" },
        { label: "Phone", value: "PHONE" },
        { label: "Other", value: "OTHER" },
      ],
    }];
  }

  return [];
});
