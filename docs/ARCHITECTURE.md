# Architecture

Five systems:

1. **Connectivity** — app catalog, OAuth, API keys, webhook subscriptions, encrypted connections
2. **Automation** — versioned graphs of triggers, actions, searches, filters, paths, loops, delays, code, HTTP
3. **Execution** — BullMQ queues, workers, retries, idempotency, logs
4. **Data + AI** — tables, forms, files, copilot, agents/MCP hooks
5. **Platform** — users, orgs, workspaces, RBAC, usage, billing, audit, admin

Tenant rule: every business row has `organization_id` and/or `workspace_id`. API middleware loads membership before queries.

Execution rule: API enqueues; workers run adapters. Long work never blocks HTTP.

Secrets rule: AES-256-GCM at rest; redaction in logs; no tokens in REST responses.
