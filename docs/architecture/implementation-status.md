# Implementation Status

Branch: `architecture-refactor-2026-08`

This is a controlled refactor branch. `main` is not modified by this work.

## Phase 1 — Foundation / safety

- [x] Create isolated architecture-refactor branch.
- [x] Add target architecture and service boundaries.
- [x] Harden `.gitignore` for generated artifacts and TypeScript build info.
- [x] Remove generated repository snapshots and `.freebuff` logs from the refactor branch.
- [x] Align root workspace scripts with the actual `@algoverge/*` package names.
- [ ] Remove the remaining `.kilo` gitlink after verifying it is not required by the development workflow.
- [ ] Remove already-tracked `tsconfig.tsbuildinfo` after obtaining its exact blob reference; it is ignored for future commits.

## Phase 2 — Runtime boundaries

- [ ] Move the DB-aware execution orchestration currently living under `apps/api/src/engine.ts` behind the canonical `packages/engine` boundary without changing behavior.
- [ ] Make worker depend on the canonical execution boundary rather than importing `apps/api/src/*`.
- [ ] Move schedule/poll discovery out of worker into the scheduler process.
- [ ] Give scheduler the DB/queue dependencies it needs and add leader/overlap protection.
- [ ] Preserve manual builder execution (`enqueue: false`).

## Phase 3 — Integrations

- [ ] Establish one generic integration contract: app manifest -> auth -> trigger/action/search -> adapter -> operation schema.
- [ ] Map existing WhatsApp/Meta, Google Calendar, Google Sheets, Stripe, Calendly and other adapters into that contract.
- [ ] Preserve existing operation behavior while migrating.

## Phase 4 — Builder/UI

- [ ] Audit every frontend route and feature against the product specification.
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

## Phase 6 — Verification

- [ ] Typecheck all TypeScript workspaces.
- [ ] Build all runtime services.
- [ ] Unit tests.
- [ ] Integration tests.
- [ ] E2E tests for critical automation flows.
- [ ] Python service tests.
- [ ] Fix every failure before merge.

## Deletion policy

No dependency is removed as part of this refactor. A file/folder may only be deleted when its repository-wide references have been checked and the replacement/compatibility path is known. Existing production features are not deleted merely because the target architecture is different.
