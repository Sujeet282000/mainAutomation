import bcrypt from "bcryptjs";
import { APP_CATALOG } from "./catalog";
import { env } from "./config";
import { pool, query } from "./db";

async function main() {
  await query(
    `insert into plans (slug, name, monthly_price_cents, automation_limit, task_limit, member_limit, connection_limit, features)
     values
     ('free','Free',0,5,100,2,3,'{"polling":"15m"}'::jsonb),
     ('professional','Professional',2900,null,2000,10,50,'{"polling":"2m","paths":true}'::jsonb),
     ('team','Team',6900,null,50000,null,null,'{}'::jsonb),
     ('business','Business',29900,null,null,null,null,'{"sso":true}'::jsonb),
     ('enterprise','Enterprise',0,null,null,null,null,'{"sso":true,"scim":true}'::jsonb)
     on conflict (slug) do nothing`
  );

  for (const app of APP_CATALOG) {
    await query(
      `insert into apps (slug, name, description, category, icon, color, auth_type, manifest)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (slug) do update set name=excluded.name, description=excluded.description, manifest=excluded.manifest`,
      [app.slug, app.name, app.description, app.category, app.icon, app.color, (app as { authType?: string }).authType ?? "none", JSON.stringify(app)]
    );
  }

  const hash = await bcrypt.hash(env.seedAdminPassword, 10);
  const user = await query<{ id: string }>(
    `insert into users (email, password_hash, full_name, email_verified_at)
     values ($1,$2,'Platform Admin', now())
     on conflict (email) do update set password_hash=excluded.password_hash
     returning id`,
    [env.seedAdminEmail, hash]
  );
  const userId = user[0].id;
  await query(`insert into profiles (user_id) values ($1) on conflict (user_id) do nothing`, [userId]);

  const org = await query<{ id: string }>(
    `insert into organizations (name, slug, plan_slug) values ('Algoverge','algoverge','professional')
     on conflict (slug) do update set name=excluded.name returning id`
  );
  const orgId = org[0].id;
  await query(
    `insert into org_members (org_id, user_id, role) values ($1,$2,'owner')
     on conflict (org_id, user_id) do nothing`,
    [orgId, userId]
  );
  // Create default project (the routes.ts table, not 'workspaces')
  await query(
    `insert into projects (org_id, name, slug) values ($1,'Main','main')
     on conflict on constraint projects_org_id_slug_key do nothing`,
    [orgId]
  );

  const webhookGraph = {
    nodes: [
      { id: "t", type: "trigger", appSlug: "webhook", operation: "catch_hook", label: "Catch Hook", position: { x: 80, y: 80 }, config: {} },
      { id: "a", type: "action", appSlug: "http", operation: "request", label: "HTTP Request", position: { x: 80, y: 240 }, config: { method: "POST", url: "https://httpbin.org/post", body: "{{trigger}}" } }
    ],
    edges: [{ id: "e1", source: "t", target: "a" }]
  };
  const scheduleGraph = {
    nodes: [
      { id: "t", type: "trigger", appSlug: "schedule", operation: "cron", label: "Every hour", position: { x: 80, y: 80 }, config: { cron: "0 * * * *", timezone: "UTC" } },
      { id: "a", type: "action", appSlug: "http", operation: "request", label: "Ping", position: { x: 80, y: 240 }, config: { method: "GET", url: "https://httpbin.org/get" } }
    ],
    edges: [{ id: "e1", source: "t", target: "a" }]
  };

  const filterGraph = {
    nodes: [
      { id: "t", type: "trigger", appSlug: "manual", operation: "button", label: "Manual", position: { x: 80, y: 80 }, config: {} },
      { id: "f", type: "logic", appSlug: "filter", operation: "only_continue_if", label: "Filter", position: { x: 80, y: 220 }, config: { left: "{{trigger.ping}}", operator: "equals", right: "true" } },
      { id: "a", type: "action", appSlug: "formatter", operation: "text", label: "Uppercase", position: { x: 80, y: 360 }, config: { input: "{{trigger.ping}}", transform: "upper" } }
    ],
    edges: [
      { id: "e1", source: "t", target: "f" },
      { id: "e2", source: "f", target: "a" }
    ]
  };

  const calendarDemo = {
    nodes: [
      {
        id: "t",
        type: "trigger",
        appSlug: "google-calendar",
        operation: "new_event",
        label: "New Event",
        position: { x: 80, y: 80 },
        config: { calendarId: "primary" }
      },
      {
        id: "a",
        type: "action",
        appSlug: "email",
        operation: "send",
        label: "Email me",
        position: { x: 80, y: 240 },
        config: {
          to: "you@example.com",
          subject: "New calendar event: {{trigger.summary}}",
          body: "Starts {{trigger.start}}"
        }
      }
    ],
    edges: [{ id: "e1", source: "t", target: "a" }]
  };
  const openaiDemo = {
    nodes: [
      {
        id: "t",
        type: "trigger",
        appSlug: "webhook",
        operation: "catch_hook",
        label: "Catch Hook",
        position: { x: 80, y: 80 },
        config: {}
      },
      {
        id: "ai",
        type: "action",
        appSlug: "openai",
        operation: "summarize",
        label: "Summarize",
        position: { x: 80, y: 240 },
        config: { text: "{{trigger}}" }
      },
      {
        id: "mail",
        type: "action",
        appSlug: "email",
        operation: "send",
        label: "Send summary",
        position: { x: 80, y: 400 },
        config: { to: "you@example.com", subject: "AI summary", body: "{{steps.ai.text}}" }
      }
    ],
    edges: [
      { id: "e1", source: "t", target: "ai" },
      { id: "e2", source: "ai", target: "mail" }
    ]
  };
  const sheetsDemo = {
    nodes: [
      {
        id: "t",
        type: "trigger",
        appSlug: "manual",
        operation: "button",
        label: "Manual",
        position: { x: 80, y: 80 },
        config: {}
      },
      {
        id: "cal",
        type: "action",
        appSlug: "google-calendar",
        operation: "create_event",
        label: "Create Event",
        position: { x: 80, y: 240 },
        config: {
          calendarId: "primary",
          summary: "Algoverge demo",
          start: new Date(Date.now() + 3600000).toISOString(),
          end: new Date(Date.now() + 7200000).toISOString()
        }
      }
    ],
    edges: [{ id: "e1", source: "t", target: "cal" }]
  };
  const gmailToSheetsDemo = {
    nodes: [
      { id: "gmail-new-email", type: "trigger", appSlug: "gmail", operation: "new_email", label: "New Email", position: { x: 80, y: 80 }, config: { query: "" }, connectionId: null },
      {
        id: "sheets-append-row",
        type: "action",
        appSlug: "google-sheets",
        operation: "append_row",
        label: "Append Email to Sheet",
        position: { x: 80, y: 240 },
        config: { drive: "my-drive", spreadsheetId: "", sheet: "", values: '["{{trigger.receivedAt}}","{{trigger.from}}","{{trigger.subject}}","{{trigger.snippet}}"]' },
        connectionId: null
      }
    ],
    edges: [{ id: "e-gmail-sheets", source: "gmail-new-email", target: "sheets-append-row" }]
  };

  await query(
    `insert into automation_templates (slug, name, description, category, required_apps, graph)
     values
     ('webhook-to-http','Webhook to HTTP','Catch a webhook and POST it anywhere','getting-started', ARRAY['webhook','http'], $1::jsonb),
     ('schedule-http','Scheduled ping','Cron trigger then HTTP','getting-started', ARRAY['schedule','http'], $2::jsonb),
     ('filter-format','Filter then format','Manual trigger, filter, formatter','logic', ARRAY['manual','filter','formatter'], $3::jsonb),
     ('calendar-to-email','New Calendar event → Email','When a Google Calendar event is created, email a summary (connect Calendar + Resend).','google', ARRAY['google-calendar','email'], $4::jsonb),
     ('webhook-ai-email','Webhook → OpenAI → Email','Catch JSON, summarize with OpenAI, email via Resend.','ai', ARRAY['webhook','openai','email'], $5::jsonb),
     ('manual-create-event','Test: create a Calendar event','Manual trigger that creates a timed event on primary calendar.','google', ARRAY['manual','google-calendar'], $6::jsonb),
     ('gmail-to-sheets-email-log','Gmail to Google Sheets email log','When a new Gmail email arrives, append its received time, sender, subject, and snippet to a selected worksheet. Connect Google, choose the spreadsheet and worksheet, then test.','google', ARRAY['gmail','google-sheets'], $7::jsonb)
     on conflict (slug) do update set name=excluded.name, description=excluded.description, graph=excluded.graph, category=excluded.category, required_apps=excluded.required_apps`,
    [
      JSON.stringify(webhookGraph),
      JSON.stringify(scheduleGraph),
      JSON.stringify(filterGraph),
      JSON.stringify(calendarDemo),
      JSON.stringify(openaiDemo),
      JSON.stringify(sheetsDemo),
      JSON.stringify(gmailToSheetsDemo)
    ]
  );

  console.log(`Seeded admin ${env.seedAdminEmail} / ${env.seedAdminPassword}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
