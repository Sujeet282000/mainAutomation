AUTOMATION PLATFORM
Production Implementation Specification
A Full-Featured, Zapier- and Activepieces-Class Workflow Automation Platform
Product, Architecture & Engineering Specification — v1.0
Classification: Internal / Engineering
Prepared for production build-out — covers product features, system architecture, data model, APIs, security, deployment, and delivery roadmap.
Table of Contents
1.  Executive Summary
2.  Product Vision, Positioning & Personas
3.  Complete Feature Catalog
4.  System Architecture
5.  Core Data Model
6.  Execution Engine — Runtime Internals
7.  Integration Framework — Piece SDK Specification
8.  Public API Specification (REST, v1)
9.  Security, Privacy & Compliance
10.  Non-Functional Requirements
11.  Delivery Roadmap
12.  End-to-End Reference Scenario
13.  Appendix — Glossary
1. Executive Summary
This document is the complete production-level specification for building a full-featured workflow automation platform in the class of Zapier, Make.com, and Activepieces. It defines every product feature, the underlying system architecture, the data model, the API surface, the integration (“Piece”) framework, execution engine internals, security and compliance controls, deployment topology, pricing/metering, and the delivery roadmap needed to take the product from zero to a production SaaS plus self-hosted offering.
The platform lets non-technical and technical users connect any two or more applications, trigger automations from events, transform and route data, call AI models and autonomous agents, pause for human approval, and monitor everything end to end — while giving developers an open extensibility framework to add new integrations, and giving enterprises the security, governance, and deployment controls they require.
Goals of this specification
Serve as the single source of truth for product, engineering, design, security, and DevOps teams building the platform.
Enumerate every feature area with functional detail sufficient to write user stories and acceptance criteria.
Define a scalable, queue-based execution architecture proven at the scale of billions of monthly task executions.
Specify the extensibility model (Piece/Connector SDK) that allows the integration catalog to scale to thousands of apps.
Cover both multi-tenant cloud SaaS and self-hosted / air-gapped enterprise deployment.
Competitive frame of reference
Feature parity and differentiation targets are benchmarked against three market leaders:
Platform
Model
Differentiator to match or beat
Zapier
Closed-source, cloud-only, per-task billing
Largest app catalog (7,000–9,000+ apps), Zapier Copilot, Zapier Central agents
Activepieces
Open-source (MIT), cloud + self-hosted, credit billing
MCP-native, embeddable builder SDK, unlimited self-hosted runs
Make.com
Closed-source, visual scenario builder, operations billing
Highly granular visual data-mapping, complex iteration/aggregation tools
The platform specified here targets: an open, credit-metered SaaS with a free self-hosted community edition; a visual builder with AI-assisted flow generation; a 500+ integration catalog at launch scaling via a public SDK; native AI agents and Model Context Protocol (MCP) support; and enterprise-grade security (SSO, SCIM, RBAC, audit, air-gap) from day one of the Enterprise tier.
2. Product Vision, Positioning & Personas
2.1 Vision Statement
Enable any team — regardless of technical skill — to describe an outcome in plain language or a visual canvas, and have the platform reliably connect their applications, move their data, apply logic and AI, and execute that outcome automatically, forever, with full visibility and control.
2.2 Product Pillars
Visual-first workflow builder with an optional “describe it in chat” entry point (AI Copilot).
Deep integration catalog via an open, developer-friendly connector framework.
Native AI: model calls, autonomous agents, and Model Context Protocol (MCP) as first-class citizens, not bolt-ons.
Human-in-the-loop control: approvals, forms, and chat interfaces embedded directly into automations.
Deployment freedom: multi-tenant cloud, single-tenant cloud, or fully self-hosted / air-gapped.
Enterprise-grade trust: SSO/SCIM, RBAC, audit logging, encryption, and compliance certifications.
2.3 Primary Personas
Persona
Goals
Key Features Used
Business Ops / RevOps User
Automate lead routing, CRM sync, reporting without code
Templates, visual builder, Tables, forms
Support / Success Manager
Escalate tickets, notify teams, auto-respond
Branch/Switch logic, To-Dos, Slack/Email pieces
Developer / Platform Engineer
Build custom integrations, embed automation in product
Piece SDK, Embed SDK, API, Webhooks, Code step
IT / Security Admin
Govern access, ensure compliance, control spend
SSO/SCIM, RBAC, audit logs, credit/usage dashboards
AI/Automation Power User
Chain LLMs and agents across tools autonomously
AI Agent Builder, MCP, AI steps, Chat interface
3. Complete Feature Catalog
This section enumerates every feature area required for production parity with market-leading automation platforms. Each subsection is written to be directly convertible into epics and user stories.
3.1 Workflow Builder (Visual Canvas)
Canvas & Editing
Vertical, top-to-bottom flow diagram: Trigger → Action 1 → Action 2 → …
Drag-and-drop step insertion from a searchable, categorized piece sidebar
Right-hand configuration panel per selected step, with inline validation
“Data to Insert” panel: exposes every upstream step's output fields for point-and-click mapping
Expandable nested JSON objects (caret-based drill-down) for deeply nested API responses
Undo/redo, autosave, and draft vs. published state separation
Zoom, minimap, and auto-layout for large flows
Inline step testing with real sample data pulled from the connected account
Flow-level testing that simulates the trigger and runs the full chain end to end
Flow Lifecycle
Draft → Published state machine; publishing registers webhooks/polling/schedules
Automatic versioning on every publish, with one-click rollback to any prior version
Duplicate flow, export/import flow as JSON, and folder-based organization
Templates gallery (200+ starter templates by department: sales, marketing, support, finance, IT, HR)
3.2 Triggers
Trigger Types
Instant / webhook triggers — near-zero latency via registered callback URLs
Polling triggers — scheduled API polling with cursor/timestamp de-duplication
Schedule (cron) triggers — interval, daily, weekly, custom cron expressions
Manual triggers — on-demand run from the UI or API
Form triggers — publish a hosted form; submission starts the flow
Chat triggers — inbound chat message starts or continues a flow
App-event triggers exposed by each Piece (e.g., “New Email”, “New Row”, “New Deal”)
Trigger Configuration
Field-level filters (e.g., only fire when subject contains a keyword)
“Load Sample Data” — pulls a real, recent record so users can see exact available fields
Trigger-level authentication via the Connections system (OAuth2, API key, custom)
3.3 Actions
Action Capabilities
Thousands of pre-built actions across the Piece catalog (create/update/delete/get/find/list operations per app)
Generic HTTP Request action for any REST/GraphQL API not yet covered by a Piece
Code step (JavaScript/Python) with npm/pip package support for custom logic
Static text and dynamic variable mixing in any input field ({{step.field}} syntax)
Per-step test execution with real or synthetic sample payloads
Conditional field visibility (dynamic forms that adapt based on prior answers)
3.4 Logic & Control Flow
Built-in Logic Blocks
Branch (If/Else) — binary conditional split
Switch / Paths — multi-way conditional routing on a single field
Loop / Iterator — run downstream steps once per item in an array
Delay / Wait — pause for a fixed duration or until a specific timestamp
Filter — stop the run entirely unless a condition is met
Formatter — text, date/time, numeric, and array/object transformation utilities
Auto-retry with configurable count and exponential backoff
Error path / fallback handler per step for graceful degradation
Sub-flows — call a reusable flow as a step from within another flow
3.5 Human-in-the-Loop
To-Dos & Approvals
Pause a run and create a task assigned to a user or role
Approve/Reject actions with optional comment capture
Editable fields presented to the approver before resuming
Configurable timeout / escalation if no response within N hours
Resume execution automatically from the paused step upon approval
Forms & Chat Interfaces
Hosted, brandable web forms (text, number, file upload, dropdown, multi-select) as flow triggers
Flow can return a synchronous response to the form (markdown, redirect, or file download)
Embeddable chat widget backed by an AI agent that can call flows as tools
3.6 Data Tables (Built-in Database)
Tables Capabilities
Spreadsheet-like tables scoped to a project, usable as flow inputs/outputs
Column types: text, number, boolean, date, single-select, multi-select, file, relation
Triggers: New Record Created, Record Updated, Record Deleted
Actions: Create/Update/Delete/Get/Find Records, Create/Delete Table, Clear Table, Export as CSV
Import from CSV, and bulk row operations
Used as durable context/state storage for long-running or agentic flows
3.7 AI & Agent Capabilities
AI Copilot (Builder Assistant)
Natural-language flow generation — describe the automation, get a draft flow with steps pre-wired
Inline suggestions for next steps, field mappings, and prompt writing
AI Steps
Model-agnostic AI action step supporting OpenAI, Anthropic, Google, and self-hosted/open models
Sub-capabilities: text generation, summarization, classification, structured data extraction, vision/image understanding, text-to-speech, speech-to-text/transcription, embeddings, image generation
Prompt editor mixing static instructions with dynamic upstream data
Autonomous Agents
Agent builder: define role, instructions, and a toolset drawn from any connected Piece
Multi-step reasoning and tool-calling loop with configurable max iterations and budget
Agents can browse the web, query databases, call arbitrary connected-app actions, and make branching decisions
Agents callable as a flow step, or as the endpoint of a chat interface
Model Context Protocol (MCP)
Every connected Piece is auto-exposed as a set of MCP tools
External MCP clients (Claude Desktop, Cursor, IDE agents, custom LLM apps) can invoke platform flows and actions as callable tools
Platform can also act as an MCP client, consuming external MCP servers as agent tools
MCP tool invocations reuse the calling user's existing encrypted connections — no separate auth
3.8 Integration Framework (“Pieces” / Connectors)
Catalog
500+ integrations at GA, organized by category (CRM, marketing, finance, support, dev tools, AI, productivity, e-commerce, databases, communication)
Generic HTTP/GraphQL connector for anything without a dedicated integration
Custom, private pieces scoped to a single organization (not published publicly)
Piece SDK (Developer Framework)
TypeScript SDK: each Piece declares auth methods, triggers, actions, and typed input schemas
Local hot-reload development experience and a CLI scaffolding tool
Publish pipeline: pieces published to a package registry are automatically available platform-wide after review
Versioned pieces with backward-compatible upgrade paths for existing flows
3.9 Connections & Authentication
Supported Auth Types
OAuth 2.0 (authorization code + refresh token, automatic silent refresh)
API Key / token-based auth
Basic Auth (username/password)
Custom auth (bespoke handshake defined by the piece)
No-auth (public APIs)
Connection Management
Reusable, named connections shared across many flows within a project
Human-readable connection labels (derived from OAuth claims or user-entered)
Connection health states: Active, Expired, Error — with reconnect prompts
Project-level and organization-level (global) connection scoping
All credentials encrypted at rest with 256-bit keys; never exposed in logs
3.10 Execution, Testing & Monitoring
Testing
Per-step test execution using real sample data from the connected account
Full-flow simulation before publishing
Execution & History
Per-run execution timeline with per-step input/output payloads and durations
Status tracking: Running, Succeeded, Failed, Paused
Replay a run from the beginning or from the failed step
Sensitive-field data masking in logs
Configurable log retention by plan (cloud) or unlimited (self-hosted)
Alerting
Email/Slack/webhook notifications on run failure
Digest notifications for teams (daily/weekly failure summaries)
3.11 Collaboration & Workspace Management
Team Features
Multi-user workspaces / organizations with multiple isolated projects
Roles: Owner, Admin, Editor, Viewer, and custom RBAC roles (Enterprise)
Real-time presence indicators (who else is viewing/editing a flow)
Comments and change history on flows
Per-project execution priority / concurrency allocation
3.12 Enterprise, Security & Compliance
Identity & Access
SSO via SAML 2.0 and OIDC
SCIM-based user provisioning and de-provisioning
Custom role-based access control (RBAC) down to the resource level
Governance & Auditability
Immutable audit log of every user and admin action
Platform governance: enforce allowed pieces, connections, and templates org-wide
Git-backed flow version sync with promotion across dev/staging/prod environments
Data Protection
Encryption at rest (256-bit) and in transit (TLS 1.2+)
Field-level data masking in execution logs
Secret manager integration (e.g., Vault, AWS Secrets Manager, GCP Secret Manager)
Network isolation and fully air-gapped self-hosted deployment option
SOC 2 Type II certified cloud offering; support for HIPAA-eligible and data-residency configurations
3.13 Embeddable Automation (White-Label SDK)
Embed Capabilities
JavaScript SDK to embed the visual builder as an iframe inside a third-party SaaS product
JWT-based end-user provisioning — host app issues signed tokens to authenticate embedded users
White-labeling: custom branding, logo, color theme, light/dark mode, custom fonts
Selective UI toggling: hide/show sidebar, Tables, global search, active-user indicators, import/export, duplicate, folders, page headers
Full connection and piece management surfaced (or hidden) inside the host product
Template management and an in-app MCP settings dialog
Localization out of the box across 14+ languages
Navigation event handler to keep host-app routing in sync with the embedded builder
3.14 Developer Platform & Extensibility
APIs & Webhooks
Full REST API for programmatic flow, connection, and run management
Inbound webhooks to trigger any flow externally
Outbound webhook action to POST data to any external endpoint
Formula/expression editor with documentation links, usable in embedded contexts
Open-Source & Community
MIT-licensed core with a public GitHub repository
Community-contributed Pieces published to a public package registry
Public roadmap and issue tracker
3.15 Billing, Metering & Plans
Metering Model
Credit-based metering: one flow run = 1 credit regardless of step count; AI steps consume 2–20 credits depending on model cost
“Bring your own AI key” reduces AI steps to flat 1-credit cost
Pay-as-you-go overage billing beyond plan allocation
Self-hosted Community Edition: unlimited runs, zero metering
Plan Tiers
Free — limited daily credits, community support
Plus / Team — higher credit pools, collaboration features, priority support
Enterprise — SSO/SCIM, custom RBAC, audit logs, SLAs, dedicated support, self-hosted licensing
Embed — separate licensing tier for the white-label SDK
3.16 Localization & Accessibility
UI and embed SDK localized across English, Spanish, French, German, Portuguese, Dutch, Italian, Russian, Ukrainian, Bulgarian, Hungarian, Japanese, Indonesian, Vietnamese, Chinese (Simplified & Traditional)
Keyboard navigability and screen-reader-friendly builder components (WCAG 2.1 AA target)
4. System Architecture
4.1 Architectural Principles
Queue-first execution: every trigger event becomes an immutable job; workers are stateless and horizontally scalable.
Multi-tenant by default with strict project/organization isolation at the data layer.
Everything-as-a-Piece: triggers, actions, and auth are implemented behind one plugin interface so the core engine never special-cases an app.
API-first: the UI is a client of the same public API available to developers.
Deployability parity: the same container images run in multi-tenant cloud, single-tenant cloud, and fully offline self-hosted environments.
4.2 High-Level Component Diagram
            ┌───────────────────────────┐            │         Web Client          │            │ (Builder UI, Dashboard,     │            │  Embed SDK host apps)       │            └──────────────┬────────────┘                            │ HTTPS / WSS            ┌──────────────▼────────────┐            │        API Gateway          │            │ (Auth, rate limit, WAF)     │            └──────────────┬────────────┘      ┌───────────────────┼────────────────────┐      ▼                    ▼                    ▼┌───────────┐     ┌─────────────┐     ┌───────────────┐│ Core API   │     │ Flow Engine  │     │ Connection /    ││ Svc        │     │ Svc          │     │ Auth Svc         ││ (flows,    │     │ (versioning, │     │ (OAuth, API key,  ││  billing)  │     │  publish)    │     │  refresh)         │└─────┬─────┘     └──────┬──────┘     └────────┬────────┘      └───────────┬───────┴───────────┬─────────┘                   ▼                   ▼        ┌───────────────────┐  ┌────────────────────┐        │ Trigger Listener     │  │ Piece Registry Svc   │        │ (webhook, poll,       │  │ (published Pieces,    │        │  scheduler)           │  │  sandboxed loader)     │        └──────────┬──────────┘  └──────────┬──────────┘                    ▼                        │        ┌───────────────────┐                │        │ Message Queue        │◄─────────────┘        │ (Redis/BullMQ, or     │        │  Kafka at scale)      │        └──────────┬──────────┘                    ▼        ┌───────────────────┐     ┌────────────────────┐        │ Worker Fleet          │◄───►│ AI / Agent Gateway   │        │ (sandboxed steps,     │     │ (LLM routing,         │        │  retries)             │     │  MCP server/client)   │        └──────────┬──────────┘     └────────────────────┘                    ▼        ┌───────────────────┐        │ Execution Store       │        │ (run history, logs,   │        │  masked payloads)     │        └──────────┬──────────┘                    ▼        ┌───────────────────┐        │ Primary Database      │        │ (Postgres, multi-      │        │  tenant schemas)       │        └───────────────────┘
4.3 Recommended Technology Stack
Layer
Technology
Rationale
Frontend
React + TypeScript, canvas via React Flow, state via Redux/Zustand
Rich drag-and-drop builder, component reuse for Embed SDK
API Layer
Node.js (NestJS/Fastify) or equivalent typed backend
Shares TypeScript types with the Piece SDK
Execution Queue
Redis + BullMQ (startup/mid-scale) → Kafka (high scale)
At-least-once delivery, retry/backoff support, horizontal workers
Primary Database
PostgreSQL (multi-tenant, row-level security)
Strong consistency for flows, connections, billing
Object/Blob Storage
S3-compatible storage for attachments, exports, logs
Cheap, durable, portable across cloud/self-hosted (MinIO)
Secrets/Credentials
Envelope encryption (KMS) + optional external secret manager
256-bit encryption at rest, key rotation
Search
Postgres full-text or OpenSearch for large catalogs/logs
Piece and run-log search at scale
Container Orchestration
Docker Compose (self-hosted) / Kubernetes + Helm (cloud & enterprise)
Parity between deployment modes
Observability
OpenTelemetry, Prometheus, Grafana, structured logging
Per-step tracing across the execution engine
4.4 Multi-Tenancy Model
Organization → Project → Flow hierarchy; every row in the primary schema is scoped by organization_id and project_id.
Row-level security policies enforce tenant isolation at the database layer, not just in application code.
Enterprise customers may opt into single-tenant database/cluster isolation or full self-hosting.
4.5 Deployment Topologies
4.5.1 Multi-Tenant Cloud (SaaS)
Auto-scaling worker pools shared across tenants, isolated by tenant-scoped resource quotas
Managed Postgres, managed Redis/Kafka, managed object storage
Blue/green deployments; zero-downtime schema migrations
4.5.2 Self-Hosted (Community & Enterprise)
Docker Compose for single-node installs; Helm chart for Kubernetes-based clusters
Horizontal worker scaling controlled entirely by the customer's infrastructure
Fully air-gapped mode: no outbound calls to the vendor; license validation via offline token
Identical container images and schema versioning as the cloud offering, enabling smooth migration in either direction
5. Core Data Model
The schema below is the minimum viable relational model. Enterprise features (RBAC, audit, git-sync) extend it with additional tables noted in Section 7.
Entity
Key Fields
Notes
organizations
id, name, plan_tier, credit_balance, created_at
Top-level tenant boundary
users
id, org_id, email, password_hash / sso_subject, role
SCIM-synced in Enterprise
projects
id, org_id, name, environment (dev/stage/prod)
Isolation unit within an org
connections
id, project_id, piece_name, auth_type, encrypted_credentials, status
Reusable auth session
flows
id, project_id, name, status (draft/published), current_version_id
Top-level automation object
flow_versions
id, flow_id, version_number, definition_json, published_at
Immutable per-publish snapshot
flow_runs
id, flow_version_id, status, started_at, finished_at, credits_used
One row per execution
run_steps
id, run_id, step_name, input_json, output_json, status, duration_ms
Per-step execution record, masked
pieces
id, name, version, auth_schema, triggers_json, actions_json
Registry of installed/available integrations
tables
id, project_id, name, schema_json
Built-in database feature
table_records
id, table_id, data_json, created_at, updated_at
Row storage for Tables
todos
id, run_id, assignee_id, status, payload_json, resolved_at
Human-in-the-loop approvals
webhooks
id, flow_id, url_token, secret
Inbound trigger endpoints
audit_logs
id, org_id, actor_id, action, target, metadata_json, created_at
Enterprise governance
5.1 Execution Context Model
Each Flow Run maintains a shared, append-only execution context — a JSON object keyed by step name. Downstream steps may read any ancestor's output but never sibling branches that did not execute, and never write to context keys other than their own. This context is what powers the “Data to Insert” panel and the {{step_name.field}} templating syntax at runtime.
6. Execution Engine — Runtime Internals
6.1 Publish-Time Behavior
Persist a new immutable flow_version snapshot of the flow definition.
Register webhooks with source apps for webhook-based triggers.
Schedule polling jobs (cron) for polling-based triggers.
Activate schedule triggers in the cron scheduler.
Flip the flow's status to Published; prior version remains available for rollback.
6.2 Trigger Detection → Run Creation
Event Source (webhook POST | poll tick | cron tick | manual | form | chat)        │        ▼Trigger Listener validates payload / dedupes via cursor        │        ▼Flow Run created (status = QUEUED, unique run_id)        │        ▼Job enqueued on the Message Queue (topic keyed by tenant + priority)        │        ▼Available Worker dequeues job
6.3 Sequential Step Execution
Workers execute steps strictly in the order defined by the flow's directed graph (linear chain, or branch/switch/loop sub-graphs). For each step the worker:
Resolves all {{step.field}} template tokens against the execution context.
Fetches and decrypts the required Connection credential; refreshes an OAuth2 token if expired.
Loads the versioned Piece code in a sandboxed runtime (isolated process or V8 isolate) and invokes the action/trigger handler.
Executes the underlying HTTP call(s) to the target application.
Parses the response and writes the step's output into the execution context.
Persists a run_step record (masked) with status, timing, and payloads.
On failure: applies exponential-backoff retry up to the configured limit, then marks the run Failed and halts downstream steps (unless an error-path handler is defined).
6.4 Branching, Loops & Delay Semantics
Branch/Switch: engine evaluates the condition against the execution context and walks only the matching sub-graph; non-executed branches never populate the context.
Loop: the engine iterates the bound array, spawning one execution pass of the loop body per item, aggregating outputs into an array in the context.
Delay: the run is checkpointed and dehydrated from the worker; a scheduled job rehydrates and resumes it at the target time, so long delays do not hold a worker slot.
To-Do/Approval: identical dehydrate/rehydrate mechanism, resuming on human action rather than a timer.
6.5 Error Handling Matrix
Error Class
Examples
Engine Behavior
Transient
Network timeout, 5xx, 429 rate limit
Automatic retry with exponential backoff, configurable attempts
Authentication
401 / 403
Immediate fail; connection flagged Error; user prompted to reconnect
Validation
400 / malformed payload
Immediate fail; step highlighted with the offending field
Fatal / Unhandled
Unexpected exception in Piece code
Run marked Failed; full stack trace captured (redacted) for support/debug
6.6 Billing Metering Hook
On run completion, the billing service debits the organization's credit balance: 1 credit for the run itself (regardless of non-AI step count), plus 2–20 credits per AI step depending on the model invoked, or 1 flat credit if the organization supplied its own model API key. Self-hosted Community Edition installs skip this hook entirely.
7. Integration Framework — Piece SDK Specification
7.1 Anatomy of a Piece
A Piece is a versioned TypeScript package declaring authentication, triggers, and actions. Example skeleton:
export const slackPiece = createPiece({  name: "slack",  displayName: "Slack",  auth: OAuth2Auth({ scopes: ["chat:write", "channels:read"] }),  triggers: [newMessageTrigger, newChannelCreatedTrigger],  actions: [sendMessageAction, createChannelAction, addReactionAction],});export const sendMessageAction = createAction({  name: "send_message",  displayName: "Send Message to Channel",  props: {    channel: Property.Dropdown({ required: true, refreshers: ["auth"] }),    message: Property.LongText({ required: true }),  },  async run(context) {    return callSlackApi("chat.postMessage", {      channel: context.propsValue.channel,      text: context.propsValue.message,    }, context.auth);  },});
7.2 Auth Handshake Implementations
7.2.1 OAuth 2.0
User clicks "Create Connection"    -> platform opens popup to app's OAuth authorize URL    -> user authorizes    -> app redirects back with an authorization code    -> platform exchanges code for access_token + refresh_token    -> tokens encrypted (256-bit) and stored against the Connection row    -> connection labeled from token claims (email / workspace name)
7.2.2 API Key
User opens a piece requiring API-key auth    -> pastes key, optionally names the connection    -> platform encrypts and stores the key    -> connection becomes selectable from any flow in the project
7.3 Publishing Pipeline
Developer scaffolds a piece via CLI and implements auth/triggers/actions locally with hot reload.
Automated test suite validates schema, auth flow, and sample action calls in a sandbox.
Security review scans for unsafe network calls, disallowed dependencies, and secret leakage.
Piece is published to the internal package registry and versioned; it becomes available platform-wide without a platform redeploy.
Existing flows pin to the piece version they were built against until the user explicitly upgrades.
7.4 Trigger Implementation Strategies
Webhook-based: piece exposes a registerWebhook/deregisterWebhook lifecycle hook.
Polling-based: piece exposes a poll() function; engine supplies the last cursor/timestamp and stores the new one.
Both strategies are abstracted behind the same Trigger interface so the core engine treats them identically.
8. Public API Specification (REST, v1)
All endpoints are served under /api/v1, authenticated via Bearer API key or OAuth2 access token, and scoped to the caller's organization/project.
Method & Path
Purpose
POST /flows
Create a new flow (draft)
GET /flows/{id}
Retrieve a flow definition and current status
PUT /flows/{id}
Update a draft flow's step definition
POST /flows/{id}/publish
Publish the current draft as a new version
POST /flows/{id}/run
Trigger a manual run
GET /flows/{id}/runs
List execution history for a flow
GET /runs/{id}
Get full step-by-step detail for a single run
POST /runs/{id}/replay
Replay a run from the beginning or a given step
POST /connections
Create a new connection (initiates OAuth or stores API key)
GET /connections
List connections available to the project
DELETE /connections/{id}
Revoke and delete a connection
GET /pieces
List available integrations and their triggers/actions
GET /pieces/{name}/actions/{action}
Get the input schema for a specific action
POST /tables/{id}/records
Create a record in a Table
GET /tables/{id}/records
Query records in a Table
POST /todos/{id}/approve
Approve a paused human-in-the-loop task
POST /todos/{id}/reject
Reject a paused human-in-the-loop task
POST /webhooks/{token}
Public inbound endpoint that starts a flow run
GET /organizations/{id}/usage
Retrieve credit/usage metering for billing
8.1 Webhook Payload Contract (Inbound)
POST /webhooks/{token}Content-Type: application/json{  "event": "lead.created",  "data": { "name": "Jane Doe", "email": "jane@example.com", "budget": 15000 },  "timestamp": "2026-08-23T10:15:00Z"}
8.2 Run Object Shape
{  "id": "run_4821",  "flow_id": "flow_9001",  "status": "SUCCEEDED",  "started_at": "2026-08-23T10:15:00.080Z",  "finished_at": "2026-08-23T10:15:03.600Z",  "credits_used": 3,  "steps": [    { "name": "trigger", "status": "SUCCEEDED", "duration_ms": 40 },    { "name": "step_1_openai", "status": "SUCCEEDED", "duration_ms": 300 },    { "name": "step_2_hubspot", "status": "SUCCEEDED", "duration_ms": 2400 }  ]}
9. Security, Privacy & Compliance
9.1 Identity & Access Management
SAML 2.0 and OIDC SSO for enterprise identity providers (Okta, Azure AD, Google Workspace)
SCIM 2.0 for automated user lifecycle provisioning/de-provisioning
Custom RBAC: resource-level permissions (per project, per flow, per connection)
9.2 Data Protection
Encryption at rest: AES-256 envelope encryption for all stored credentials and sensitive payloads
Encryption in transit: TLS 1.2+ enforced on all external and internal service traffic
Field-level masking of sensitive values (tokens, PII patterns) in execution logs
Configurable data residency — region-pinned database and storage for regulated customers
9.3 Application Security
Sandboxed execution of Piece code (isolated process / V8 isolate) to prevent cross-tenant interference
Static and dynamic security scanning in the Piece publishing pipeline
Rate limiting and WAF at the API gateway; signed webhook payloads with replay protection
Secret manager integrations: HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager
9.4 Compliance Targets
Standard
Applicability
SOC 2 Type II
Multi-tenant cloud offering
GDPR
EU customer data handling, data residency, right-to-erasure workflows
HIPAA-eligible configuration
Healthcare customers on dedicated/self-hosted deployments
ISO 27001 (target)
Enterprise tier roadmap
9.5 Audit & Governance
Immutable, queryable audit log of every create/update/delete/publish/approve action
Git-backed flow sync enabling code-review-style promotion across dev/stage/prod
Org-level governance policies restricting which Pieces, connections, and templates are usable
10. Non-Functional Requirements
Category
Target
Availability
99.9% uptime SLA for multi-tenant cloud; 99.95% for Enterprise single-tenant
Trigger Latency
< 500 ms from webhook receipt to run creation; polling interval configurable from 1–15 minutes by plan
Throughput
Design target of 1B+ task executions/month at cloud scale, horizontally scaled via worker autoscaling
Concurrency
Per-project and per-organization concurrency caps to guarantee fair multi-tenant resource sharing
Data Retention
90 days execution logs on cloud standard plans; unlimited/configurable on self-hosted and Enterprise
Recovery
RPO ≤ 5 minutes, RTO ≤ 30 minutes for the primary database via continuous backup and point-in-time restore
Extensibility
New Piece can be developed, tested, and published without a core platform deployment
Localization
UI and Embed SDK support 14+ languages at GA
11. Delivery Roadmap
Phase 0 — Foundations (Weeks 1–6)
Core data model, multi-tenant auth, project/org structure
Flow CRUD + visual builder canvas (linear flows only)
Piece SDK v1 with 10–15 launch integrations (Gmail, Slack, Sheets, HTTP, Webhooks, OpenAI)
Queue-based execution engine: trigger → run → sequential actions → logging
Phase 1 — Core Feature Parity (Weeks 7–16)
Branch/Switch/Loop/Delay/Filter logic blocks
Connections management UI, OAuth2 + API key auth types
Execution history, replay, versioning/rollback
Tables (built-in database) and To-Dos (human-in-the-loop)
Expand catalog to 150+ Pieces via community/internal SDK adoption
Phase 2 — AI & Agents (Weeks 17–24)
AI action steps across major model providers
AI Copilot for natural-language flow generation
Autonomous Agent builder with tool-calling
MCP server/client support
Phase 3 — Enterprise & Scale (Weeks 25–36)
SSO/SCIM, custom RBAC, audit logging, governance policies
Self-hosted Docker/Helm distribution and air-gapped mode
Credit-based billing, usage dashboards, plan tiers
Catalog expansion to 500+ Pieces
Phase 4 — Platform & Embed (Weeks 37–48)
Embeddable white-label builder SDK with JWT provisioning
Public API v1 GA, developer documentation portal
Localization rollout across 14+ languages
Forms and Chat interfaces as first-class trigger surfaces
12. End-to-End Reference Scenario
Scenario: a prospect submits a web form. The system summarizes their answers with AI, creates a CRM contact, notifies the sales channel, and — if the deal value exceeds $10,000 — pauses for manager approval before marking the lead “Hot.”
TRIGGER: Form — "New Submission"    -> captures name, email, company, budget, use_case        |        vACTION 1: AI Step — "Summarize lead"    prompt: "Summarize this lead: {{trigger.use_case}}"    -> context.step_1.summary        |        vACTION 2: CRM Piece — "Create Contact"    name: {{trigger.name}}, email: {{trigger.email}}    notes: {{step_1.summary}}        |        vACTION 3: Chat Piece — "Send Message to #sales"    message: "New lead: {{trigger.name}} — $" + "{{trigger.budget}}"        |        vBRANCH: if {{trigger.budget}} > 10000    TRUE  -> To-Do: "Request manager approval"              (Flow PAUSES; resumes on Approve)              -> Action: CRM "Mark Hot Lead"    FALSE -> Action: CRM "Set Status = Nurture"
This single scenario exercises the trigger layer, AI step, integration actions, dynamic data mapping, conditional branching, and the human-in-the-loop approval mechanism — the same set of primitives that every automation on the platform is composed from.
13. Appendix — Glossary
Term
Definition
Piece
A versioned integration package defining auth, triggers, and actions for one external app
Flow
A user-defined automation composed of a trigger and one or more downstream steps
Flow Run
One execution instance of a published flow, with its own execution context and logs
Execution Context
The shared, append-only JSON object holding every step's output for a single run
Connection
An encrypted, reusable authenticated session with an external app
Credit
The platform's billing unit; 1 flow run = 1 credit; AI steps cost more depending on model
MCP
Model Context Protocol — a standard letting LLM clients call external tools, including flows
To-Do
A human-in-the-loop task that pauses a run pending approval or input