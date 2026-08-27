# Architecture and phase gaps

Sources: this repo, `Automation_Platform_Production_Specification_extracted.md`, `Activepieces_Integration_Flow_extracted.md`.

## What exists (control + execution plane)

- **Tenancy:** orgs, workspaces, membership roles, RLS policies for anon/browser roles (`002_rls.sql`). API uses a privileged `DATABASE_URL`.
- **Auth:** register/login JWT. Supabase Auth columns/env are reserved; Docker login stays on local JWT.
- **Automations:** CRUD, versioned graphs, publish, webhook URL, manual run, schedule registration on publish.
- **Builder:** React Flow canvas, catalog-driven steps (registered adapters only), field mapping, connection picker, path handles.
- **Execution:** API enqueues BullMQ; **worker process** runs adapters. Delay/HITL **resume from next node** (does not replay the trigger). Retry creates a new run. Viewer role is read-only.
- **Triggers:** webhook catch, manual, cron ticker in the worker, form POST, Stripe/WhatsApp inbound webhooks.
- **Logic (Phase 2, working):** Filter, Paths, Loop, Delay, Formatter, Sheets find/search, table find.
- **Connections:** AES-256-GCM at rest; Google OAuth start/callback when `GOOGLE_*` is set.
- **Adapters:** registry keyed by `appSlug:operation` (WhatsApp, Google Calendar/Sheets/Gmail/Drive, Stripe, OpenAI/Anthropic/Gemini, Slack, GitHub, HTTP, core logic). Missing handler **throws** instead of fake success.
- **Data:** tables + records, forms + public submit, templates (use creates a real automation).
- **HITL:** approval step pauses the run; `/approvals` decide resumes or cancels. **Agents** are a separate product at `/agents`.
- **Products:** Tables/Forms/Interfaces/Canvas/Chatbots with public `/f`, `/i`, `/c` routes. SDK at `/sdk/apps` + `/sdk/run`. Task metering: successful actions only; built-in logic + Tables/Forms free; MCP `invoke_action` is 2x.
- **AI:** FastAPI `apps/ai`; editor Copilot calls it (503 if the service is down — no fake graph).
- **MCP:** HTTP MCP at `/mcp` with hashed workspace tokens, scopes, and `audit_logs`. REST `POST /mcp/tools/:name`.
- **Platform UI:** org/workspaces/members, folders, version list + graph diff, webhook event log, form submissions + public `/f/:workspaceId/:slug`, billing plans/usage, Stripe Checkout when keys exist, API keys, MCP tokens.
- **Stack lock:** Next.js/TS/Tailwind/shadcn-style/React Flow/Zustand/TanStack Query/RHF/Zod, Express, Postgres, Redis/BullMQ, Python FastAPI.

## Phase map

| Phase | Spec intent | Status |
| --- | --- | --- |
| **1** | Signup, org/workspace, RBAC, CRUD, visual trigger→actions, publish, webhook/manual/schedule, engine, history, retry, encrypted connections, generic catalog | **Solid enough to run.** Polling cursors tick in the worker. Google refresh tokens persist back to the connection. Custom RBAC tables unused, no SSO. |
| **2** | Filter, Paths, Loops, Delay, Formatter, Search, Templates, dynamic fields | **Implemented for core + Google Sheets sheet list.** More dynamic dropdowns (Slack channels, HubSpot lists) still need live APIs + keys. |
| **3** | Code sandbox isolates, error paths, version diff, folders | Code step is `vm` with 1.5s timeout (not a real isolate). Folders + version list/diff APIs/UI exist. Dedicated error-path nodes still thin. |
| **4** | Tables/forms as product, files, interfaces, realtime run stream | Tables/forms APIs, submissions, public form page work; no Supabase Storage/Realtime wiring yet. |
| **5** | Billing, usage gates, admin, MCP, enterprise SSO/SCIM, 9k apps | Plans/usage + billing UI. Stripe Checkout is real when `STRIPE_*` is set, otherwise fails closed. **Workspace MCP is live.** Catalog is dozens of apps, not thousands. No SSO/SCIM. |

## Intentionally not faked

Buttons that exist call APIs. Copilot does not invent a graph if FastAPI is down. Unregistered catalog apps are hidden in the builder. Stripe Checkout is not shown as success until you provide keys; the Subscribe button returns the Stripe error or `stripe_not_configured`. Dynamic fields go through the adapter registry (Google Sheets, Slack), not `if (app === "google")`.
