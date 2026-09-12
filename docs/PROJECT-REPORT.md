# Orchestra (Algoverge) — Full Project Report

*Generated 2026-09-11. Re-verify anytime with the commands in “Verification”.*

## 1. What the product is

A Zapier/ActivePieces-class automation platform with a built-in AI layer:

- **Visual workflow builder** — React Flow canvas, 164-app integration catalog,
  triggers (webhook/cron/schedule/manual), per-step testing, versions + publish.
- **AI everywhere** — Copilot (builds/edits workflows from chat), Agents (autonomous
  tool-using loops with approvals), Chatbots (public share links), AI steps.
- **Product surfaces** — Tables, Forms, Interfaces, Canvas, Connections, Developer
  apps/SDK, Transfers, Email parsers.
- **Runtime** — Node API (`apps/api` :4000), Next.js web (`apps/web` :3000), Python
  AI plane (`apps/ai` :8000), worker + scheduler, Postgres (Supabase-style).

## 2. Repository layout

```
apps/
  api/        Express control plane (routes.ts ~3.5k lines, ui-compat, modules/)
  web/        Next.js 15 app-router UI (feature-first under features/)
  ai/         Python FastAPI model gateway + 10-stage copilot pipeline
  worker/     async step executor        scheduler/  cron trigger ticks
packages/
  shared/ core/ db/ engine/ ai-agent/    contracts, graph IR, schema, exec engine, agent loop
supabase/migrations/  0001…0017 (single ordered runner: apps/api/src/migrate.ts)
tools/                api-audit.mjs, db-audit.ts
docs/                 api-surface.md, PROJECT-REPORT.md
```

## 3. Database architecture

**Core spec schema (0001):** organizations → org_members → projects → flows →
flow_versions → flow_runs (**partitioned monthly by created_at**) → run_steps;
pieces + piece_operations + piece_embeddings (HNSW); connections (sealed secrets);
todos, audit_logs, ai_usage, usage_counters. RLS + functions in 0002.

**Execution model:** `flow_runs` rows keyed `(id, created_at)` with an idempotency
unique index; `run_steps` carries step attempts with generated `duration_ms`,
error_json, output_preview. Partitions are auto-created by `ensureRunPartition()`
(current + next month) on every run.

**Compat layers:** 0004/0008 add the UI-product tables (workspace_items, agents,
agent_runs (0011/0012), agent_activities (0013), triggers_registry (0014),
chatbots/canvases/interfaces, chatbot_messages 0016); 0015 adds developer_apps /
transfer_jobs / email_parsers; 0017 removes redundant duplicate indexes.

**Sequencing guarantees (found & fixed this session):**
- `run_steps.run_created_at` must equal `flow_runs.created_at` **exactly** (FK to the
  partition). Insert path re-reads the stored timestamp; detail/stream endpoints now
  join inside Postgres instead of round-tripping through JS (microsecond loss).
- Index dedupe: unique-constraint indexes kept, redundant plain indexes dropped
  (0017) — less write amplification on run_steps / usage_counters.

## 4. API surface (summary)

Full map with dispositions: **docs/api-surface.md**. Highlights:

- `auth/register|login`, `me` — JWT + `x-workspace-id`
- `automations` CRUD + `run|publish|validate|test-step|duplicate` (publish →
  version + trigger activation + webhookUrl)
- `executions` list/detail/SSE stream/retry (real error messages)
- `analytics/summary?days=N` — server-side aggregates (daily, trigger mix, slowest
  steps, failures w/ messages, latency p50/p95/p99)
- `connections` CRUD + per-vendor live credential tests (69 testers)
- `oauth/:provider/start|callback` — generic OAuth2 for 28 providers
- `copilot/sessions/:id/*` SSE pipeline; `chat` universal endpoint
- Public share surfaces `/public/{forms,chatbots,interfaces}/*`
- Legacy families (`flows`, `runs`, `table-assets`, stateless `copilot/*`) kept and
  documented — pruning rule documented, tool to re-diff provided.

## 5. AI provider strategy

Cascade order everywhere: **OpenAI → Anthropic → Gemini → Groq → local LLM**.
- Node: `agent/model-router.ts` (agent loop, chatbots, copilot fallback,
  `ai-runtime.completeAi`).
- Python: `ModelGateway._complete` cascade (same order, per-provider retries,
  401/403 cascade too). All-providers-failed → clean 503 `ALL_MODEL_PROVIDERS_FAILED`;
  Node maps it to a friendly user message. Raw provider errors are never surfaced
  as chat replies (guarded on both sides). No mock providers anywhere.

## 6. Features — status

| Area | Status |
| --- | --- |
| Auth, orgs, workspaces | ✅ (E2E covered) |
| Workflow builder + publish + webhook/cron triggers | ✅ (E2E covered) |
| Executions inspector (steps, errors, retry, SSE) | ✅ (steps-visibility bug fixed) |
| Analytics dashboard (dynamic, hover graphs, CSV/PDF) | ✅ (server aggregates added) |
| Connections + 164-app catalog + Zapier-style auth fields | ✅ |
| OAuth (28 providers, token-paste fallback) | ✅ (client env optional) |
| Copilot (build/edit workflows), thinking UI | ✅ |
| Agents + activities + approvals | ✅ |
| Chatbots / Interfaces / Canvas / Tables / Forms | ✅ |
| Developer apps (hashed secrets), SDK run, transfers, email parsers | ✅ |
| Notifications, audit, usage, billing, settings | ✅ |
| Sidebar (fixed shell, independent scroll, consistent collapse) | ✅ fixed |
| Migrations (`npm run migrate`) | ✅ fixed & verified |

## 7. Verification

```
npm run migrate                    # applies 0001…0017 cleanly
npm run dev                        # api :4000, web :3000, worker, scheduler, ai :8000
npm run typecheck                  # all packages
(cd apps/web && npx tsc -p tsconfig.json --noEmit && npm test)   # web + vitest (4)
npm test -w @algoverge/api         # 50 tests across 4 suites, 0 fail
npm run test:e2e -w @algoverge/api # 14 E2E incl. full register→publish→run walk
node tools/api-audit.mjs           # FE/BE surface diff
node tools/db-audit.ts             # index/FK audit
```

Current status: **all typechecks green; API 50/50, E2E 14/14, guards 11/11, web 4/4.**
