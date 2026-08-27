# Orchestra Target Architecture

## Purpose
This document is the implementation boundary for the automation platform. Existing behavior must be preserved while responsibilities are separated into clear services.

## Runtime topology

```text
Next.js Web
    |
    v
Node API (control plane) ----> PostgreSQL/Supabase
    |
    v
Redis / BullMQ
    |
    v
Worker(s) ----> Execution Engine ----> Integration adapters
    |                    |
    |                    +-----------> Python AI service
    |
Scheduler -------------------------> BullMQ

MCP is a tool boundary for AI/clients, not a second execution engine.
```

## Service responsibilities

### apps/web
UI only: authentication screens, dashboard, automation builder, integrations/connections, execution history/logs, templates, settings, billing/usage, tables/forms/interfaces and AI/agent experiences. It must never receive provider secrets or perform workflow execution.

### apps/api
Control plane: auth, organization/workspace/membership authorization, automation CRUD/versioning/publishing, connections/OAuth callbacks, integration catalog APIs, webhook ingress, execution creation/control, usage/billing APIs and admin/security endpoints.

### packages/engine
Canonical execution-domain library. It owns graph traversal, step lifecycle, mapping/expression evaluation, branching, loops, waits, retries, idempotency and execution context contracts. It must not depend on an application process.

### apps/worker
Execution plane. It consumes BullMQ jobs, invokes the engine and records execution state. It must not contain cron/poll discovery logic and must not import apps/api internals after the engine migration is complete.

### apps/scheduler
Trigger discovery plane. It finds due scheduled/polling work and enqueues execution jobs. It does not execute workflow steps.

### apps/ai
Python AI runtime: model calls, agent orchestration and AI-specific processing. Node services communicate through a stable HTTP contract.

### apps/mcp
MCP protocol/tool boundary. MCP tools may invoke platform capabilities through supported APIs/services; MCP must not duplicate the workflow runtime.

### packages/db
Database access, repositories, migrations and transaction helpers. Every tenant-scoped query must include organization/workspace authorization context.

### packages/integrations (future canonical boundary)
Generic app manifest, auth strategy, triggers, actions, searches, webhook adapters and operation schemas. Existing pieces/pieces-sdk/pieces-framework are retained until dependency analysis proves a safe consolidation path.

## Non-negotiable rules

1. Multi-tenant scope is organization_id + workspace_id + membership/role/permission, never user_id alone.
2. Secrets remain server-side: OAuth client secrets, refresh tokens, service-role keys, provider secret keys and database credentials never reach the browser.
3. PostgreSQL/Supabase is the control-plane source of truth; Redis/BullMQ is the execution queue.
4. Published automation versions are immutable execution inputs.
5. Execution state and step logs are persisted and resumable.
6. Existing integrations are converted into the generic integration model instead of creating one-off runtimes.
7. Do not delete an existing feature unless its replacement, migration and compatibility strategy are documented.
8. TypeScript strictness, validation, structured errors, logging and tests are required for production changes.

## Required end-to-end flows

Account -> organization -> workspace -> connection -> automation -> trigger -> trigger test -> action -> mapping -> filters/paths/loops/delay/AI/code/webhook/API/approval/subflow -> workflow test -> publish -> automatic execution -> logs -> retry/replay.

The platform must also support tables, forms, interfaces, AI agents, MCP clients, custom integrations/SDK, usage, billing, teams and governance as the product specification is delivered.
