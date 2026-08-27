# Orchestra — Full Project Documentation

> **Orchestra** — AI-Native Workflow Automation & Orchestration Platform
> Monorepo: npm workspaces (`apps/*`, `packages/*`) + Python AI service + Supabase (Postgres) + Redis + Docker.

---

## 1. High-Level Architecture

```
                        ┌──────────────────────────────────────────┐
                        │                 BROWSER                   │
                        │        apps/web  (Next.js App Router)     │
                        └───────┬─────────────────────┬────────────┘
                                │ REST /fetch         │ OAuth redirect
                        ┌───────▼────────┐    ┌───────▼────────┐
                        │   apps/api     │◄──►│  Supabase Auth │
                        │ (Fastify TS)   │    └────────────────┘
                        └───┬───┬───┬────┘
              enqueue jobs  │   │   │  catalog/copilot/auth
          ┌─────────────────▼┐ ┌▼───▼──────────────┐   ┌──────────────┐
          │    Redis Queue   │ │   Postgres (DB)   │   │  apps/ai     │
          │                  │ │  supabase/migra-  │   │ (FastAPI Py) │
          │                  │ │  tions = schema   │   │ prompts +    │
          └───────┬──────────┘ └───────▲───────────┘   │ LLM glue     │
                  │ consume            │ read/write    └──────▲───────┘
          ┌───────▼──────────┐         │                      │ HTTP
          │   apps/worker    ├─────────┘                      │
          │ (flow executor)  │        ┌───────────────────────┴──┐
          └──────────────────┘        │      packages/engine     │
                                      │ expression eval + steps  │
          ┌──────────────────┐        └──────────────────────────┘
          │  apps/scheduler  │  cron-like polling triggers → enqueues runs
          └──────────────────┘
          ┌──────────────────┐
          │    apps/mcp      │  MCP server exposing platform as tools
          └──────────────────┘

          Supabase (Postgres + Auth + RLS) = single source of truth
          docker-compose.yml → postgres + redis for local dev
          deploy/keda-worker.yaml → KEDA autoscaling of workers in prod
```

### Data flow of one automation run
1. **Trigger fires** — Webhook hits `apps/api/src/triggers/webhook-ingress.ts`, or scheduler (`polling-scheduler.ts`) finds due polling triggers.
2. API creates a `run` row + job(s) in **Redis queue**.
3. **apps/worker** picks up the job, loads flow definition via `packages/core`, executes step-by-step with **packages/engine** (expression evaluation, branching, retries).
4. Steps call external apps through **pieces** connectors (`packages/pieces/*`, `packages/pieces-framework`, `packages/pieces-sdk`).
5. Every step result/logs written back to Postgres; user watches it live on `/runs/[id]`.
6. On failure → retry policy from `deploy/runbooks.md`; KEDA scales workers by queue depth.

---

## 2. Services (run with `npm run dev`)

| Service | Location | Stack | Port / Role |
|---|---|---|---|
| **web** | `apps/web` | Next.js 15 App Router, React Flow builder, Tailwind | UI: dashboard, flows editor, runs, connections, AI page, login/register |
| **api** | `apps/api` | Node + Fastify, TypeScript | Main backend: auth, catalog, copilot, connections/OAuth, metering, MCP tools, webhook ingress, trigger activation, seed/migrations |
| **worker** | `apps/worker` | Node, Redis consumer | Executes automation runs using `@orchestra/engine` |
| **scheduler** | `apps/scheduler` | Node | Cron/polling: finds scheduled & polling triggers, enqueues runs |
| **ai** | `apps/ai` | Python FastAPI (`main:app`, port 8000) | Copilot LLM service; prompts in `apps/ai/prompts/copilot/*.txt`; called by API copilot-engine |
| **mcp** | `apps/mcp` | TypeScript | Model Context Protocol server — exposes Orchestra as tools for external AI agents |

Common commands:
```
npm run dev          # all services concurrently
npm run dev:api|web|worker|ai
npm run docker:up    # local postgres + redis
npm run migrate      # apply supabase migrations
npm run seed         # demo data
npm run test         # jest tests in apps/api
npm run typecheck    # tsc over shared, core, db, api
```

---

## 3. Packages (`packages/*`) — shared libraries

| Package | Purpose |
|---|---|
| `shared` | Common TS types/utilities (built first in `build` script) |
| `core` | Flow schema, resolver, invariants, services, config, graph bridge — the domain model |
| `engine` | Execution engine: executor + expression evaluator (+ tests) |
| `db` | DB client wrapper |
| `crypto` | Encryption for connection credentials |
| `observability` | Metrics + log redaction |
| `pieces` | Connector pieces (slack, hubspot, http) |
| `pieces-framework` | Framework for authoring pieces |
| `pieces-sdk` | SDK around pieces framework |
| `types` | Extra type-only definitions |
| `validation` | Shared validators |
| `ai` | AI-related TS helpers (client side of apps/ai) |

---

## 4. Database (`supabase/`)

- `config.toml` — local Supabase CLI config.
- Migrations applied in order:
  - `0001_init.sql` — tables: workspaces, users, flows, connections, etc.
  - `0002_rls_and_functions.sql` — Row-Level-Security policies + SQL functions (tenant isolation).
  - `0003_additional_tables.sql` — more tables (runs, logs, metering...).
  - `0004_ui_product_compat.sql` — compatibility layer for UI-facing queries.
- API also has runtime safety-net: `apps/api/src/ensure-schema.ts` (creates missing tables if migrations weren't applied).
- Multi-tenancy enforced by RLS keyed on workspace id; tested in `apps/api/src/__tests__/tenant-isolation.test.ts`.

---

## 5. Key folders explained

```
apps/
  web/app/(workspace)/   → authenticated pages (dashboard, flows, runs,
                           automations, apps, connections, ai, templates,
                           settings, billing, tables, forms, approvals…)
  web/features/          → React feature modules (workflow-builder canvas,
                           shell layout, connections)
  web/lib/               → api client, graph normalization, catalog, copilot helpers
  api/src/triggers/      → webhook ingress + polling scheduler + activation svc
  api/src/adapters/      → external app adapters (generic)
  api/src/pieces/        → server-side piece catalog index
  api/src/mcp/           → MCP tool definitions served over API
  worker/src/            → job consumer + run executor bootstrap
  scheduler/src/         → cron loop
connectors/              → standalone connector projects
pieces/hello-world/      → sample custom piece scaffold
docs/                    → design docs
deploy/                  → keda-worker.yaml (K8s autoscaling), runbooks.md
test-run.js              → ad-hoc manual smoke scripts (safe to delete)
test_register.js
```

---

## 6. ✅ SAFE TO DELETE — not used by any runtime/dev/test path

Delete these to clean up ~large amounts of dead weight:

| Path | Why safe |
|---|---|
| `.kilo/worktrees/imported-neutral/` | ⚠️ FULL DUPLICATE COPY of an older version of the whole project (its own apps/, packages/, supabase/). Only used by the "kilo" AI editor worktree. Biggest cleanup win. |
| `apps/web/.next/` | Next.js build cache — regenerated automatically by `next dev/build` |
| `apps/api/dist/` | Compiled output — regenerated by `tsc`/build |
| `node_modules/` + lockfile caches | Regenerated with `npm install` (keep package-lock.json!) |
| `supabase/.temp/` | Supabase CLI temp state |
| `test-run.js`, `test_register.js` (root) | One-off manual scripts, not wired into `npm test` |
| `apps/api/src/_preview_probe.ts` | Underscore-prefixed scratch/probe file, not imported anywhere |
| `.freebuff/` | Editor plugin artifacts |
| `.cursor/rules/` | Cursor IDE rules — keep only if you use Cursor |

**Check-before-deleting** — none left: every package below was verified via codebase-wide import search.

⚠️ **DO NOT delete these even though they look peripheral** (verified real imports):
- `packages/ai` (`@algoverge/model-gateway`) → imported by `apps/api/src/copilot-engine.ts`, `apps/api/src/pieces/catalog-index.ts`
- `packages/crypto` (`@algoverge/crypto`) → imported by `apps/api/src/crypto.ts`, `orchestra-core.test.ts`
- `packages/engine` → tested via `apps/api` `test:orchestra` script

✅ **Verified 100% unreferenced** (zero imports anywhere in the workspace — full codebase search for `@algoverge/types`, `@algoverge/validation`, `@orchestra/observability`, `@algoverge/pieces-framework` returned no source-code matches):

| Path | Verified |
|---|---|
| `packages/types` | no file imports it |
| `packages/validation` | no file imports it |
| `packages/observability` | no file imports it |
| `packages/pieces-framework` | only listed in lockfile, never imported in source — delete **then** also run `npm install` afterwards so `package-lock.json` / `node_modules` links refresh |

After deleting any of the above, run: `npm install && npm run typecheck && npm run test`. Green = confirmed safe.

Never delete: `supabase/migrations`, `packages/core|engine|db|shared`, anything referenced in root `package.json` scripts, `docker-compose.yml`, `deploy/`.

To remove safely: delete → run `npm install && npm run typecheck && npm run test` → everything still green means nothing was needed.

---

*Generated automatically from the current repository state.*
