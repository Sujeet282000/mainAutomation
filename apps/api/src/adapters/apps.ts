import { authHeaders, requireOk } from "./http";
import { registerAdapter, registerDynamicFields } from "./registry";

registerAdapter("slack", "new_message", async ({ input }) => ({ output: input }));
registerAdapter("slack", "send_message", async ({ input, auth }) => {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { ...authHeaders(auth), "content-type": "application/json" },
    body: JSON.stringify({ channel: input.channel, text: input.text })
  });
  const body = await requireOk(res, "Slack");
  if (body.ok === false) throw new Error(`Slack: ${String(body.error)}`);
  return { output: body };
});

registerDynamicFields("slack", async ({ auth }) => {
  if (!auth) return [{ key: "channel", label: "Channel ID", type: "string" }];
  const res = await fetch("https://slack.com/api/conversations.list?limit=200&types=public_channel,private_channel", {
    headers: authHeaders(auth)
  });
  const body = await requireOk(res, "Slack channels");
  const channels = ((body.channels as { id?: string; name?: string }[]) ?? []).filter((c) => c.id);
  return [
    {
      key: "channel",
      label: "Channel",
      type: "select",
      options: channels.map((c) => ({ label: `#${c.name ?? c.id}`, value: String(c.id) }))
    }
  ];
});

registerAdapter("github", "new_issue", async ({ input }) => ({ output: input }));
registerAdapter("github", "create_issue", async ({ input, auth }) => {
  const [owner, repo] = String(input.repo).split("/");
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: { ...authHeaders(auth), "content-type": "application/json", accept: "application/vnd.github+json" },
    body: JSON.stringify({ title: input.title, body: input.body })
  });
  return { output: await requireOk(res, "GitHub issue") };
});

registerAdapter("discord", "send_message", async ({ input }) => {
  const res = await fetch(String(input.webhookUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: input.content })
  });
  if (!res.ok) throw new Error(`Discord webhook failed (${res.status})`);
  return { output: { status: res.status } };
});

registerAdapter("telegram", "send_message", async ({ input, auth }) => {
  const token = String(auth?.api_key ?? "");
  if (!token) throw new Error("Telegram bot token missing on connection.");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: input.chatId, text: input.text })
  });
  return { output: await requireOk(res, "Telegram") };
});

registerAdapter("hubspot", "new_contact", async ({ input }) => ({ output: input }));
registerAdapter("hubspot", "create_contact", async ({ input, auth }) => {
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "POST",
    headers: { ...authHeaders(auth), "content-type": "application/json" },
    body: JSON.stringify({ properties: { email: input.email, firstname: input.firstname } })
  });
  return { output: await requireOk(res, "HubSpot contact") };
});

registerAdapter("airtable", "create_record", async ({ input, auth }) => {
  const res = await fetch(`https://api.airtable.com/v0/${input.baseId}/${encodeURIComponent(String(input.table))}`, {
    method: "POST",
    headers: { ...authHeaders(auth), "content-type": "application/json" },
    body: JSON.stringify({ fields: input.fields ?? {} })
  });
  return { output: await requireOk(res, "Airtable") };
});

registerAdapter("trello", "new_card", async ({ input }) => ({ output: input }));
registerAdapter("trello", "create_card", async ({ input, auth }) => {
  const key = String(auth?.api_key ?? "");
  const token = String(auth?.token ?? auth?.access_token ?? "");
  const url = new URL("https://api.trello.com/1/cards");
  url.searchParams.set("idList", String(input.listId));
  url.searchParams.set("name", String(input.name));
  url.searchParams.set("key", key);
  url.searchParams.set("token", token);
  const res = await fetch(url, { method: "POST" });
  return { output: await requireOk(res, "Trello") };
});

registerAdapter("shopify", "new_order", async ({ input }) => ({ output: input }));
registerAdapter("shopify", "create_customer", async ({ input, auth }) => {
  const shop = String(auth?.shop ?? "");
  const res = await fetch(`https://${shop}/admin/api/2024-10/customers.json`, {
    method: "POST",
    headers: { ...authHeaders(auth), "content-type": "application/json", "X-Shopify-Access-Token": String(auth?.access_token ?? auth?.api_key ?? "") },
    body: JSON.stringify({ customer: { email: input.email } })
  });
  return { output: await requireOk(res, "Shopify") };
});

registerAdapter("typeform", "new_entry", async ({ input }) => ({ output: input }));
registerAdapter("microsoft-teams", "new_message", async ({ input }) => ({ output: input }));
registerAdapter("microsoft-teams", "send_message", async ({ input }) => {
  const res = await fetch(String(input.webhookUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: input.text })
  });
  if (!res.ok) throw new Error(`Teams webhook failed (${res.status})`);
  return { output: { status: res.status } };
});

registerAdapter("zendesk", "new_ticket", async ({ input }) => ({ output: input }));
registerAdapter("zendesk", "create_ticket", async ({ input, auth }) => {
  const subdomain = String(auth?.subdomain ?? "");
  const user = String(auth?.email ?? auth?.username ?? "");
  const token = String(auth?.api_token ?? auth?.password ?? auth?.api_key ?? "");
  const res = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets.json`, {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(`${user}/token:${token}`).toString("base64"),
      "content-type": "application/json"
    },
    body: JSON.stringify({ ticket: { subject: input.subject, comment: { body: input.comment ?? "" } } })
  });
  return { output: await requireOk(res, "Zendesk") };
});

registerAdapter("salesforce", "new_lead", async ({ input }) => ({ output: input }));
registerAdapter("salesforce", "create_lead", async ({ input, auth }) => {
  const instance = String(auth?.instance_url ?? "").replace(/\/$/, "");
  const res = await fetch(`${instance}/services/data/v59.0/sobjects/Lead`, {
    method: "POST",
    headers: { ...authHeaders(auth), "content-type": "application/json" },
    body: JSON.stringify({ LastName: input.lastName, Company: input.company, Email: input.email })
  });
  return { output: await requireOk(res, "Salesforce") };
});
registerAdapter("notion", "create_page", async ({ input, auth }) => {
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: { ...authHeaders(auth), "content-type": "application/json", "Notion-Version": "2022-06-28" },
    body: JSON.stringify({
      parent: { database_id: input.databaseId ?? undefined, page_id: input.pageId ?? undefined },
      properties: { title: { title: [{ text: { content: String(input.title) } }] } }
    })
  });
  return { output: await requireOk(res, "Notion") };
});
registerAdapter("jira", "create_issue", async ({ input, auth }) => {
  const host = String(auth?.host ?? "");
  const user = String(auth?.email ?? auth?.username ?? "");
  const token = String(auth?.api_token ?? auth?.password ?? auth?.api_key ?? "");
  const res = await fetch(`${host}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(`${user}:${token}`).toString("base64"),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      fields: { project: { key: input.project }, summary: input.summary, issuetype: { name: "Task" } }
    })
  });
  return { output: await requireOk(res, "Jira") };
});
registerAdapter("linear", "create_issue", async ({ input, auth }) => {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { authorization: String(auth?.api_key ?? ""), "content-type": "application/json" },
    body: JSON.stringify({
      query: "mutation($title:String!){ issueCreate(input:{title:$title}){ success issue{ id title } } }",
      variables: { title: input.title }
    })
  });
  return { output: await requireOk(res, "Linear") };
});
registerAdapter("twilio", "send_sms", async ({ input, auth }) => {
  const sid = String(auth?.account_sid ?? auth?.username ?? "");
  const token = String(auth?.auth_token ?? auth?.password ?? auth?.api_key ?? "");
  const params = new URLSearchParams({ To: String(input.to), From: String(input.from), Body: String(input.body) });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") },
    body: params
  });
  return { output: await requireOk(res, "Twilio") };
});
registerAdapter("calendly", "invitee_created", async ({ input }) => ({ output: input }));


