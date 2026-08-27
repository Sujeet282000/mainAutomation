# How this repo maps to the Zapier architecture doc

Source: `docs/ZAPIER_FEATURE_ARCHITECTURE.md` (full product/architecture reference).

## Product map

| Doc product | In this app |
| --- | --- |
| Zap workflows | `/automations` + `/automations/:id/editor` |
| Canvas | `/canvas` — diagramming / generate-from-workflow (not the editor) |
| Tables | `/tables` — schema fields, rows, table triggers |
| Forms | `/forms` + public `/f/:workspaceId/:slug` — optional Table write + Zap start |
| Interfaces | `/interfaces` + public `/i/:workspaceId/:slug` |
| Agents | `/agents` — pods, knowledge, linked workflow, activity metering |
| Chatbots | `/chatbots` + public `/c/:workspaceId/:slug` |
| Approvals (HITL) | `/approvals` (separate from Agents) |
| MCP | `/developer` + `/mcp` — tool calls bill **2 tasks** via `invoke_action` |
| SDK | `GET /sdk/apps`, `POST /sdk/run` |
| Copilot | `/ai` + editor “Build it” |
| Connections | `/connections` |
| Billing / tasks | `/billing` `/usage` — successful actions only; Filter/Paths/Formatter/Delay/Loop/Sub-Zap/Digest/Storage/Manager/Tables/Forms are free |
| Developer Platform | `/developer` private app scaffold |

## Workflow editor (doc §4–8)

1. Click trigger/action → app picker modal.
2. Setup tab: app, event, account, fields, data picker (`{{trigger.*}}`, `{{vars.*}}`).
3. Test tab: Test trigger / Test step.
4. Publish turns the draft on (webhooks / poll / cron).
5. Paths router fans out; engine walks matching handles.
6. Built-ins: Filter, Paths, Loop, Delay For/Until, Formatter, Digest, Storage, Sub-Zap, Transfer, Email Parser, Manager, AI Guardrails.

## Canvas vs Zap editor

The **Zap editor** (`/automations/:id/editor`) is the vertical trigger → action builder. **Canvas** (`/canvas`) is a separate diagramming product.

Creating a canvas from a workflow must send `sourceAutomationId` (the API also accepts `sourceAutomationId`). The diagram always includes Trigger and Action boxes, even when steps are still unconfigured.

## Intentionally out of launch scope (doc §29.3 / 9,000 apps)

SSO/SCIM, static IPs, custom data retention, SOC audits, and a 9,000-app directory. Catalog covers the representative categories in §19 with live adapters (no silent success). Premium-app gating follows plan rows in `plans`.
