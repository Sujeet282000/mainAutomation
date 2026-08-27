# Repository Reorganization Plan

## Goal
Organize the demo automation platform without removing used functionality. Existing UI remains the source of truth for presentation. Runtime responsibilities are separated by ownership.

## Ownership
- `apps/web`: Next.js UI, routing, client state, API calls.
- `apps/api`: HTTP control plane, authentication, OAuth, webhooks, CRUD, execution creation, read APIs.
- `apps/worker`: BullMQ consumers and execution dispatch only.
- `apps/scheduler`: cron/poll discovery and queue dispatch only.
- `apps/ai`: Python AI/agent service; no workflow lifecycle ownership.
- `apps/mcp`: MCP transport/tools.
- `packages/engine`: canonical workflow execution runtime.
- `packages/db`: persistence/repositories/schema access.
- `packages/pieces*`: integration definitions, SDK, framework/runtime.
- `packages/core`: domain primitives.
- `packages/shared`: cross-app shared helpers/contracts.
- `packages/crypto`: secret encryption/decryption.
- `packages/observability`: logs/metrics/tracing.

## Non-negotiable migration rule
Never delete code solely because it looks old. Before deletion, prove it is unused by import/reference, route registration, dynamic loading, configuration, database migration, or runtime discovery. If used but misplaced, move or wrap it first.

## Target runtime

```text
Web -> API -> DB/Redis
             |
             +-> BullMQ -> Worker -> Engine -> Pieces -> external services
             |
             +-> AI service when an AI operation is requested

Scheduler -> API discovery -> BullMQ -> Worker
Webhooks -> API ingress -> BullMQ -> Worker
```

## Migration order
1. Inventory and classify files.
2. Preserve existing UI routes/components.
3. Define API contracts around canonical DB entities.
4. Make `packages/engine` the only workflow execution runtime.
5. Make worker execution-only.
6. Make scheduler discovery-only.
7. Consolidate integration contracts without removing existing handlers.
8. Align Python AI request/response contracts.
9. Add/repair durable waits, retries, idempotency and run-step lifecycle.
10. Verify frontend flows against APIs.
11. Run typecheck/build/tests.
12. Remove only proven-dead compatibility code.

## Frontend contract rule
Existing screens and visual components should remain intact. API changes should preserve response shapes where possible; when a shape must change, update the API client and all consuming UI together in the same migration.

## Cleanup rule
A file is `DELETE` only when all references are absent and its runtime responsibility is covered elsewhere. A file with uncertain dynamic use is `KEEP` until verified.
