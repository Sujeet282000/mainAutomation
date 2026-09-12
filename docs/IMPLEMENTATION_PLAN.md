# Algoverge Implementation Plan

Status: Active implementation plan
Date: 2026-09-12
Scope: Stabilize the existing platform, consolidate contracts incrementally, and preserve working UI/API behavior.

## Guardrails

- `apps/api` remains the HTTP/control plane; it validates and creates runs but does not become the long-term workflow executor.
- `packages/engine` is the canonical durable execution runtime.
- `apps/worker` owns queue consumption and calls `packages/engine`.
- `apps/scheduler` discovers due work and dispatches through the API/queue; it never executes workflow steps.
- Existing `automations`/`executions` compatibility tables remain until all callers are migrated and verified.
- Credentials stay server-side. AI, browser, MCP, logs, queue payloads, and graph definitions receive metadata or redacted values only.
- Copilot and agents may mutate drafts through validated operations, but never publish production versions silently.
- Every phase ends with focused tests, typecheck, and an acceptance record before the next phase starts.

## Current baseline

| Concern | Current owner | Evidence | Decision |
|---|---|---|---|
| Legacy execution | `apps/api/src/engine.ts` | `createExecution`, `runExecution`, legacy `executions` queue | Keep as compatibility path temporarily |
| Durable execution | `packages/engine/src/executor.ts` | cursor/epoch/checkpoint runtime | Make canonical |
| Worker | `apps/worker/src/index.ts` | `flow-steps` plus compatibility `executions` worker | Remove legacy worker only after migration gates |
| Scheduler | `apps/scheduler/src/index.ts` | periodic API tick | Add distributed lease first |
| Polling | `apps/api/src/poll.ts`, `triggers/polling-scheduler.ts` | cursor and DB claiming | Unify under scheduler ownership |
| Catalog | `apps/api/src/catalog/catalog.ts`, `pieces/registry.ts` | app operations and Piece cards | Introduce normalized manifest adapter |
| AI/Copilot | `packages/ai-agent`, `apps/api/src/copilot/*`, `apps/ai/*` | multiple compatible paths | Share tool/operation contracts, do not rewrite |
| MCP | `apps/api/src/mcp/*`, `apps/mcp/*` | scoped tools and `invokeTool` | Bind to the same registry and policy |
| Builder | `apps/web/features/workflow-builder/*` | React Flow graph, draft save, Copilot stream | Preserve UI and evolve API contracts together |

# Phase 0: Production foundations

## P0.1 Scheduler lease and duplicate-dispatch protection — COMPLETE

Files:
- `apps/scheduler/src/index.ts`
- `apps/scheduler/package.json`
- `apps/scheduler/src/lock.ts` (new)
- `apps/scheduler/src/lock.test.ts` (new)
- `docker-compose.yml` and deployment environment docs if a Redis setting is required

Implementation:
- Give each scheduler instance a stable process instance ID.
- Acquire `scheduler:tick:leader` with Redis `SET NX PX` and a random lease token.
- Skip the API tick when another instance owns the lease.
- Release only when the token still matches; never delete another instance's lock.
- Add configurable `SCHEDULER_LOCK_TTL_MS`, instance ID, tick ID, and structured logs.
- Use a lease TTL longer than the normal tick but shorter than the recovery interval.
- Keep local single-process overlap protection as a second guard.

Delivered:
- Redis lease implementation in `apps/scheduler/src/lock.ts` with heartbeat and token-safe release.
- Scheduler instance/tick metadata and lease configuration in `apps/scheduler/src/index.ts`.
- Three focused lease tests; scheduler build passes.

Acceptance:
- Three scheduler instances produce one API tick per interval.
- A slow tick cannot overlap another tick from the same instance.
- Lease expiry permits recovery after a crashed instance.
- A stale owner cannot release a newer owner's lease.
- Unit tests cover acquire, skip, release, expiry, and token mismatch.

## P0.2 Canonical trigger event and idempotency primitive — IN PROGRESS

Files:
- `apps/api/src/engine.ts`
- `apps/api/src/flow-runtime.ts`
- `apps/api/src/triggers/webhook-ingress.ts`
- `apps/api/src/poll.ts`
- `apps/api/src/modules/products.ts`
- schedule dispatch route/service in `apps/api/src/routes.ts` or extracted `apps/api/src/triggers/`
- `supabase/migrations/0001_init.sql` plus a new numbered migration
- `apps/api/src/__tests__/idempotency.test.ts`

Implementation:
- Define a normalized trigger envelope: `eventId`, `workspaceId`, `organizationId`, `automationId`, `versionId`, `triggerType`, `receivedAt`, `idempotencyKey`, `payload`.
- Centralize run creation behind the durable `flow_runs` path first, with a compatibility wrapper for legacy callers.
- Add a unique, tenant-scoped idempotency constraint that works across partition keys and preserves existing rows.
- Derive stable keys for webhook, polling, schedule, form, agent, Stripe, and WhatsApp events.
- Return the existing run on duplicate delivery without recording usage twice.

Delivered so far:
- Canonical `TriggerEnvelope` and stable event-key derivation.
- Atomic `trigger_events` claim table migration.
- Durable `createAndRunFlow` claims before inserting a run and returns existing duplicate runs.
- Webhook event identity is forwarded into the durable claim.
- Legacy `createExecution` now uses the same claim table and does not double-count usage or enqueue duplicates.

Remaining:
- Route schedule, polling, forms, agent, Stripe, and WhatsApp callers through the same envelope.
- Add database-backed concurrent duplicate integration tests.
- Apply the same primitive to legacy callers that currently omit event identities.

Validation note:
- API typecheck and focused tests pass. The existing standalone `idempotency.test.ts` has three unrelated runtime failures because it imports `expect` from `node:test`; those assertions fail before reaching the changed claim path.

Acceptance:
- Replaying a webhook, polling item, schedule tick, form event, or agent event returns one run.
- Concurrent duplicate inserts resolve to one run under a database uniqueness constraint.
- Version and tenant are preserved on every run.
- Existing manual builder tests still work with `enqueue: false`.

## P0.3 State machine and durable cursor completion — NEXT

Files:
- `supabase/migrations/0001_init.sql`, `0005_durable_flow_cursor.sql`, new migration
- `packages/engine/src/executor.ts`
- `apps/worker/src/engine-db.ts`
- `packages/db/src/*`
- `apps/api/src/flow-runtime.ts`
- `apps/api/src/engine.ts`
- `packages/shared/src/*` status contracts
- engine and DB tests

Implementation:
- Standardize run statuses: `queued`, `running`, `waiting`, `paused`, `retrying`, `succeeded`, `failed`, `cancelled`, `timed_out`, `expired`, with compatibility mapping for existing values.
- Standardize step statuses: `pending`, `running`, `waiting`, `succeeded`, `failed`, `skipped`, `retrying`, `cancelled`.
- Make cursor/epoch/checkpoint the only resume mechanism for delay, approval, human input, and long-running actions.
- Ensure a resume starts after the completed node and never reruns completed side effects.
- Add cancellation, timeout, lease expiry, and resume transitions with guarded updates.

Acceptance:
- Delay and approval golden flows resume after the cursor without rerunning prior steps.
- Concurrent worker transitions cannot advance the same cursor twice.
- Every state transition is valid and auditable.

## P0.4 Retry, error policy, rate limits, and redaction — IN PROGRESS

Files:
- `packages/engine/src/executor.ts`
- `apps/api/src/runtime-guards.ts`
- `apps/api/src/adapters/http.ts`
- `apps/api/src/tool-registry.ts`
- `apps/api/src/crypto.ts` and redaction helpers
- `packages/shared/src/*` retry/rate-limit contracts
- new rate-limit service and tests

Delivered so far:
- Step configuration is redacted before durable `run_steps.input_json` persistence.
- Nested access tokens, refresh tokens, cookies, authorization headers, private keys, and bearer values are redacted.
- Regression coverage proves nested execution data is safe.

Remaining:
- Normalize retry policy fields and HTTP classification.
- Honor `Retry-After` and persist retrying state.
- Add workspace, app, connection, and operation rate-limit buckets.

Implementation:
- Normalize errors into auth, validation, transient, fatal, and budget classes.
- Honor `Retry-After`; retry 429/5xx/timeouts with configurable exponential backoff, cap, and jitter.
- Do not blindly retry 401/403/404/invalid input.
- Add policy fields per operation: attempts, initial delay, maximum delay, jitter, timeout, error handler.
- Add workspace, app/integration, connection, and operation rate-limit buckets.
- Redact token/password/cookie/auth fields before logs, outputs, AI prompts, MCP responses, and browser payloads.

Acceptance:
- Retry policy tests cover all listed HTTP classes.
- Rate-limit tests prove tenant and connection isolation.
- Secret fixtures never appear in serialized logs or tool results.

## P0.5 Schema and migration gate

Files:
- all `supabase/migrations/*`
- `apps/api/src/__tests__/schema-parity.test.ts`
- `tools/db-audit.ts`
- `apps/api/src/ensure-schema.ts` and startup path
- `docs/ENVIRONMENT.md`

Implementation:
- Produce a table/column/index/foreign-key/RLS inventory tied to migration, query, shared type, UI consumer, and test.
- Resolve duplicate migration numbering and duplicate indexes with additive migrations only.
- Make production startup validate migration state and fail clearly; keep schema repair utilities diagnostic-only.
- Add CI migration-up/down or clean-database verification.

Acceptance:
- Clean database migration succeeds.
- Schema parity passes against all supported query paths.
- Production startup never mutates schema.

## P0.6 CI and certification gate

Files:
- root `package.json`
- `.github/workflows/*` or new workflow
- `apps/api`, `apps/worker`, `apps/scheduler`, `packages/engine` test configs
- `apps/ai/tests/*`

Checks:
- lint, TypeScript typecheck, unit tests, engine tests, API integration tests, migration/RLS tests, web E2E, Python tests, build, dependency/security scan, architecture boundary check.

# Phase 1: Workflow engine parity

## P1.1 Error handlers and control flow

Extend the canonical flow schema and `packages/engine/src/executor.ts` for retry, ignore/continue, fallback, notify, run-subflow, approval, and stop. Preserve existing graph-to-flow conversion in `packages/core/src/graph-bridge.ts` and add router/iterator/aggregator semantics with explicit outputs and branch handles.

## P1.2 Subflows

Add input/output schemas, workspace permissions, pinned version IDs, recursion/depth limits, timeout, error propagation, and a durable parent/child run relationship. Touch `packages/core`, `packages/engine`, DB migrations, API flow validation/routes, and builder configuration.

## P1.3 Test, replay, resume, rollback

Unify per-step test, branch test, full-flow simulation, replay-from-step, replay-with-input, and production run paths. Persist the source version and original trigger payload; never replay from a mutable draft.

## P1.4 Versioning and realtime operation UI

Use immutable `flow_versions`/automation versions for execution references. Add publish history, diff, restore, rollback, and live run events. Update `apps/web` execution detail/timeline components only after API contracts and redaction tests pass.

# Phase 2: Integration platform

## P2.1 Canonical IntegrationManifest

Create a shared contract under `packages/shared` or `packages/pieces-sdk` containing slug, version, display metadata, auth, triggers, actions, searches, dynamic fields, test connection, rate limits, and capabilities. Add adapters from `APP_CATALOG`, Piece SDK definitions, existing adapter registry, and readiness checks. Do not delete current catalog or adapters until parity tests pass.

## P2.2 Dynamic fields and connection health

Move dynamic fields behind manifest operation definitions with static, search, dependent-search, pagination, and async loading behavior. Keep connection IDs and health metadata server-side; update builder setup/configure UI and API tests.

## P2.3 Piece SDK and marketplace foundation

Add CLI commands: create, test, validate, version, publish. Validate auth, schemas, operation IDs, side-effect metadata, outputs, and compatibility. Add official/community/private installation metadata and workspace permissions without making marketplace distribution a runtime dependency.

# Phase 3: Unified AI and agent runtime

## P3.1 One provider-neutral runtime

Extend `packages/ai-agent/src/types.ts`, `tool-registry.ts`, `tool-adapters.ts`, and `loop.ts` with durable run/step/observation/approval/budget contracts while preserving current callers. Route Copilot modes (`answer`, `build`, `edit`, `configure`, `test`, `explain`, `debug`, `agent`) through the same registry.

## P3.2 Shared tools and observation loop

Bind Piece tools, workflow mutation tools, MCP tools, HTTP tools, and platform tools through one server-side registry. Enforce schema, tenant, connection, permission, risk, timeout, retry, budget, audit, and redaction checks before execution. Preserve the visual-builder `applyAgentOperations` boundary.

## P3.3 Memory, RAG, safety, evaluation, replay

Separate conversation, workspace, user preference, workflow, knowledge/RAG, and execution memory. Store operational traces only, never hidden chain-of-thought. Add risk classification and approval for external/destructive actions; add deterministic agent replay and golden tests.

# Phase 4: Product ecosystem

Complete Tables CRUD/bulk/search/views/import/export/relations/formula and record triggers; Forms validation/file upload/spam/rate limits/redirects/branding; Interfaces pages/forms/tables/detail/actions/auth; Chatbots through the same agent runtime; templates and canvas surfaces. Each capability must use the canonical manifest and durable run/idempotency services.

# Phase 5: Developer platform

Harden public API resources for workflows/runs/connections/apps/tables/forms/agents, webhooks, API keys/OAuth apps, usage/logs/rate limits, SDK, Piece SDK, MCP server, MCP client, developer portal, and embedded builder. Use JWT handoff, permissions, white-label settings, callbacks, and connection management for embeds.

# Phase 6: Enterprise and release

Add advanced RBAC, SAML/OIDC, SCIM, app/connection policies, IP restrictions, immutable audit export, retention, SIEM, secret-manager integration, environment promotion, and deployment controls. These follow the P0 security and audit contracts; they do not bypass them.

# Golden certification suite

1. Webhook -> Filter -> Sheets -> Slack.
2. Schedule -> HTTP -> AI -> Gmail.
3. Form -> Table -> Approval -> Calendar.
4. Webhook -> Router -> Slack/Gmail.
5. Webhook -> Loop -> HTTP -> Aggregator.
6. Failure -> Retry -> Fallback.
7. Delay -> Resume.
8. Approval -> Approve -> Resume.
9. Expired OAuth -> Refresh -> Continue.
10. Agent -> Tool -> Observe -> Tool -> Verify.

Each test asserts graph/version selection, idempotency, queue handoff, worker execution, state transitions, redacted observability, usage accounting, and tenant isolation.

# First implementation batch

1. Add scheduler Redis lease and focused tests.
2. Run scheduler typecheck/test and API/engine regression tests.
3. Add a normalized trigger envelope and durable idempotency migration.
4. Add duplicate/concurrent trigger tests.
5. Begin legacy execution caller inventory and route-by-route migration matrix; do not delete the compatibility worker yet.

# Definition of done

The platform is ready for production hardening only when all P0 acceptance checks pass, the canonical engine handles every new durable run, the compatibility path has no active production callers, all golden workflows pass, and the full CI gate is green.
