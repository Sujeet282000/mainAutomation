# Implementation Status

Branch: `architecture-refactor-2026-08`

This is a controlled refactor branch. `main` is not modified by this work.

## Phase 1 — Repository foundation / cleanup

- [x] Create isolated architecture-refactor branch.
- [x] Add target architecture and service boundaries.
- [x] Harden `.gitignore` for generated artifacts and TypeScript build info.
- [x] Remove generated repository snapshots and `.freebuff` artifacts from the refactor branch.
- [x] Align root workspace scripts with the actual `@algoverge/*` package names.
- [x] Remove generated documentation extraction files (`docs/_*_extract.txt`).
- [x] Remove the unused `packages/types` workspace package after repository-wide reference review.
- [x] Remove the unused `packages/validation` workspace package after repository-wide reference review.

## Phase 2 — Runtime boundaries

- [x] Establish `apps/worker` as the execution consumer.
- [x] Establish `packages/engine` as the canonical execution boundary.
- [x] Establish `apps/scheduler` as a separate scheduling/poll-discovery service.
- [x] Add authenticated scheduler -> API control-plane dispatch.
- [ ] Complete migration of all legacy execution orchestration from `apps/api/src/*` into `packages/engine`.
- [ ] Add scheduler leader/overlap protection.
- [ ] Preserve and verify manual builder execution (`enqueue: false`).

## Phase 3 — Integrations

- [ ] Establish one generic integration contract: app manifest -> auth -> trigger/action/search -> adapter -> operation schema.
- [ ] Map existing WhatsApp/Meta, Google Calendar, Google Sheets, Stripe, Calendly and other adapters into that contract.
- [ ] Preserve existing operation behavior while migrating.

## Phase 4 — Builder/UI

- [ ] Audit every frontend route and feature against the production specification.
- [ ] Verify create/configure/test/publish execution flow end-to-end.
- [ ] Verify dynamic mapping, filters, paths, loops, delays, AI, code, webhooks, API requests, approvals and subflows.
- [ ] Verify connections/OAuth and secret redaction.
- [ ] Verify execution history, detail, logs, retry and replay.

## Phase 5 — Product systems

- [ ] AI and agent system.
- [ ] Tables/forms/interfaces.
- [ ] Developer platform/API/SDK/custom integrations.
- [ ] Billing and usage.
- [ ] Security/RBAC/audit/enterprise governance.
- [ ] MCP server/client capabilities.

## Phase 6 — Verification

- [ ] Typecheck all TypeScript workspaces.
- [ ] Build all runtime services.
- [ ] Unit tests.
- [ ] Integration tests.
- [ ] E2E tests for critical automation flows.
- [ ] Python service tests.
- [ ] Fix every failure before merge.

## Cleanup policy

Only generated artifacts or repository-wide verified dead code are removed. Core architecture packages such as engine, DB, pieces SDK/framework, observability, AI, MCP, scheduler and worker are retained because they correspond to required platform boundaries. The production specification requires modular, multi-tenant, queue-based, observable and extensible architecture.
