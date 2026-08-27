# Implementation boundaries

This document is the migration contract for the demo platform. Existing working features are preserved; code is moved or adapted before it is removed.

## Runtime ownership

| Area | Owner | Must not own |
|---|---|---|
| UI, builder, pages | `apps/web` | DB, Redis, provider secrets, execution |
| HTTP/control plane | `apps/api` | long-running workflow execution |
| Queue execution | `apps/worker` | cron discovery, UI, OAuth CRUD |
| Cron/poll discovery | `apps/scheduler` | workflow step execution |
| Durable workflow runtime | `packages/engine` | HTTP route concerns |
| Persistence | `packages/db` | provider API calls |
| Integrations | `packages/pieces*` + current API adapters during migration | UI state |
| AI inference | `apps/ai` | workflow lifecycle/queue ownership |
| MCP | `apps/mcp` | a second execution engine |

## Current migration state

The repository currently contains two execution models:

1. Legacy compatibility model: `automations`, `automation_versions`, `executions`, `execution_steps` in `apps/api`.
2. Target durable model: `flows`, `flow_versions`, `flow_runs`, `run_steps` in `packages/db`, executed by `packages/engine`.

Do not delete the legacy model yet. Existing frontend/API flows still depend on it. New runtime work should target the durable model, while compatibility APIs remain until their callers are migrated.

## Queue ownership

The API may enqueue jobs, but the worker must own its Redis connection and must not import the API queue module. The worker consumes the engine queue and invokes `packages/engine`.

The scheduler discovers due work and asks the control plane to enqueue it; it does not execute workflow steps.

## Integration migration

The current `apps/api/src/adapters` implementation remains the compatibility integration layer. Do not delete or duplicate provider implementations. New engine handlers should depend on an explicit handler contract, with the existing adapter registry bridged into that contract before the old implementation is retired.

## Safe cleanup rule

Every candidate file must be classified as `KEEP`, `MOVE`, `MERGE`, `DEPRECATE`, or `DELETE`.

`DELETE` is allowed only when repository references, dynamic loading/configuration references, route usage, tests, and package exports have been checked. Removing a dependency is separate from removing source code and requires lockfile verification.

## Target execution flow

```text
web -> api -> durable flow/run creation -> Redis/BullMQ
                                      -> worker -> engine -> handler -> integration/AI
scheduler -> api/queue ------------------------------^ 
```

Manual builder tests may continue to use the compatibility API execution path until the UI is migrated to durable `flow_runs`. This avoids breaking the existing builder while the runtime is consolidated.
