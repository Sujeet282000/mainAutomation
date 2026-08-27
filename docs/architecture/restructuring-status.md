# Repository Restructuring Status

This document records the safe organization pass. It is intentionally conservative: used code is preserved until all callers are migrated.

## Ownership

- `apps/web`: existing Next.js UI and presentation.
- `apps/api`: control-plane APIs, auth, OAuth, webhooks, automation compatibility and existing adapters.
- `apps/worker`: queue consumers and execution dispatch.
- `apps/scheduler`: cron/poll discovery and dispatch to the API scheduler boundary.
- `apps/ai`: Python AI/agent runtime.
- `apps/mcp`: MCP server boundary.
- `packages/engine`: canonical workflow execution runtime.
- `packages/db`: persistence/repositories.
- `packages/pieces*`: integrations and integration SDK/framework.
- `packages/core`: domain primitives.
- `packages/shared`: genuinely shared contracts/utilities.
- `packages/crypto`: secret handling.
- `packages/observability`: telemetry.

## Completed safe cleanup

- Removed the local `_preview_probe.ts` script because it writes to a developer-specific Windows path and is not part of the application runtime.
- Removed generated documentation extraction artifacts from the repository during the earlier cleanup pass.
- Removed unused workspace packages that had no source references: `packages/types` and `packages/validation`.
- Removed the scheduler's unused `ioredis` dependency; the scheduler currently uses HTTP and timers and does not create a Redis client itself.
- Kept `.freebuff/` ignored so local inspection artifacts cannot return to source control.

## Remaining migration work

1. Trace all callers of `apps/api/src/engine.ts` and migrate them to `packages/engine` without changing frontend behavior.
2. Keep the legacy `automations`/`executions` path until every caller has moved to `flows`/`flow_versions`/`flow_runs`/`run_steps`.
3. Consolidate adapter dispatch behind the engine-facing integration contract while preserving existing adapters.
4. Remove the worker's API dependency only after the legacy execution worker is migrated; do not delete the legacy engine prematurely.
5. Audit frontend routes and services for real usage before moving or deleting any route.
6. Audit every package dependency and workspace script before removal.
7. Add end-to-end smoke coverage for API → queue → worker → engine → DB and scheduler → API → queue → worker.

## Safety rule

A file is deleted only after checking imports, route references, dynamic loading, configuration/environment references, package scripts, and runtime callers. Otherwise it is `KEEP`, `MOVE`, `MERGE`, or `DEPRECATE`.
