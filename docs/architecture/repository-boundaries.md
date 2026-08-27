# Canonical Repository Boundaries

This branch is the mass-rewrite target for the demo automation platform.

## Runtime ownership

| Area | Canonical owner | Rule |
|---|---|---|
| UI/routes/components | `apps/web` | Preserve the existing UI; change API/data wiring as needed. |
| HTTP/API/OAuth/webhooks | `apps/api` | Control plane only. It creates/updates durable state and dispatches work. |
| Durable workflow execution | `packages/engine` | Single execution model for flow versions, cursors, retries, waits and step outcomes. |
| Queue consumption | `apps/worker` | Consume BullMQ jobs and invoke the execution runtime. No cron/poll discovery. |
| Cron/poll discovery | `apps/scheduler` | Find due work and enqueue it. No workflow step execution. |
| AI/agents/copilot | `apps/ai` | Python service boundary for model/agent workloads. |
| MCP | `apps/mcp` | MCP server/client boundary. |
| Persistence | `packages/db` | Typed database repositories and transactions. |
| Shared domain | `packages/core`, `packages/shared` | Cross-service contracts/utilities only. |
| Integrations | `packages/pieces*` + integration runtime | App auth/trigger/action/search/webhook definitions. |
| Observability | `packages/observability` | Logs, metrics and tracing primitives. |
| Secrets | `packages/crypto` | Encryption/decryption and secret-safe handling. |

## Data flow

```text
Web UI
  -> API/control plane
  -> durable flow/run/version records
  -> Redis/BullMQ
  -> worker
  -> packages/engine
  -> integration handlers / AI / DB
```

Scheduled and polling triggers use:

```text
scheduler -> API scheduler dispatcher -> Redis/BullMQ -> worker -> engine
```

## Cleanup rule

Delete a file/folder only when all of the following are true:

1. It is not a runtime entry point.
2. It is not imported/referenced by source, configuration, migrations, tests or deployment.
3. It does not provide a required route, integration, schema or compatibility alias.
4. Its responsibility has a canonical replacement documented above.

Generated artifacts and extracted documentation are safe to remove when they are not source inputs.

## Migration rule

The old API execution implementation may be used as a compatibility bridge during migration, but new worker execution code must converge on `packages/engine`. Do not create a second durable run model.
