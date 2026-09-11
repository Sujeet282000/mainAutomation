# Algoverge Agent Runtime — Existing-Code Implementation Plan

**Repository:** `Sujeet282000/mainAutomation`  
**Status:** Implementation plan / engineering source of truth  
**Goal:** Evolve the existing AI/Copilot implementation into a production-grade, provider-neutral autonomous agent runtime without replacing the existing workflow engine, integration framework, queue architecture, or frontend UI.

## 1. Current architecture and decision

The repository already has the correct high-level platform boundaries:

```text
Next.js web
   -> Node/Express API / control plane
   -> Redis/BullMQ
   -> worker fleet
   -> packages/engine
   -> DB + integration adapters

worker/engine
   -> Python AI service when model inference is required

MCP
   -> capability/tool interface
```

The repository also already contains `packages/ai-agent` with a provider-neutral loop, context builder, tool registry, domain tool adapters, types, and Copilot system prompt. The package currently supports workflow/Copilot operations such as workflow inspection/mutation, integration discovery, connection metadata, and execution test/inspection.

**Do not replace this architecture.** The change is to turn these existing contracts into a durable agent runtime and connect them to the existing API, worker, engine, Pieces, MCP, connection, DB, and Python model layers.

## 2. Target behavior

An agent must be able to receive a goal, understand the tenant/workspace context, select tools, execute one or more tools, inspect observations, continue or re-plan, and finish with a grounded response.

```text
User / Voice / WhatsApp / API / Workflow
        |
        v
Agent Session / Run
        |
        v
Context Manager ---- Memory / RAG
        |
        v
Model Router ---- OpenAI / Anthropic / Gemini / Groq / other adapters
        |
        v
Agent Decision
   |             |
 final        tool call
                |
                v
          Tool Registry
                |
       permission + validation
                |
                v
          Tool Executor
          /     |      \
       Piece   MCP    Workflow
          \     |      /
                v
             Result
                |
                v
       Observation / state
                |
                v
          Agent Decision
                |
             repeat
```

The agent and deterministic workflow engine remain separate but interoperable:

- **Workflow:** deterministic graph execution.
- **Agent:** goal-oriented decision and tool loop.
- **Hybrid:** workflow invokes an agent or an agent invokes an authorized workflow/tool.

## 3. Non-negotiable constraints

1. Preserve the existing frontend/UI contracts unless an API migration is deliberately required.
2. Preserve the canonical `packages/engine` as the deterministic workflow execution runtime.
3. Keep authorization, tenant isolation, credentials, and mutations on the server/domain side.
4. Never expose OAuth tokens, API keys, refresh tokens, or encrypted credential material to the model or browser.
5. Never allow the model to write the database directly.
6. Keep workflow mutations on draft versions until the user explicitly publishes.
7. Reuse existing Pieces/integration adapters instead of creating a parallel app-specific tool implementation.
8. Reuse MCP as a tool transport/capability layer rather than building a second MCP-like system.
9. Make agent runs durable so worker restarts, retries, approvals, and long-running tasks are recoverable.
10. Do not expose hidden chain-of-thought. Persist only operational traces such as decisions/tool intents, tool inputs after redaction, results after redaction, timings, errors, and final outputs.

## 4. Workstream A — Agent contracts and state model

### A1. Extend `packages/ai-agent/src/types.ts`

Add provider-neutral contracts for:

- `AgentDefinition`
- `AgentVersion`
- `AgentRun`
- `AgentMessage`
- `AgentStep`
- `AgentObservation`
- `AgentPlan`
- `AgentToolCall`
- `AgentToolResult`
- `AgentBudget`
- `AgentPermission`
- `AgentApproval`
- `AgentMemoryReference`
- `AgentRunStatus`
- `AgentStopReason`

Required state should include:

- tenant/workspace/user/project identifiers
- agent/version/session/run identifiers
- goal/current user message
- iteration count
- tool-call count
- token/cost accounting
- started/updated/completed timestamps
- current state/status
- plan/observations references
- final result/error
- cancellation/approval state

### A2. Preserve backward compatibility

Existing `AgentContext`, `AgentResponse`, and `AgentToolCall` consumers must continue to work during migration. Introduce optional fields first, then migrate callers.

## 5. Workstream B — Durable agent runtime

### B1. Refactor `packages/ai-agent/src/loop.ts`

Keep `WorkflowAgentLoop` as the public compatibility entry point, but move its logic behind a richer runtime abstraction:

```text
AgentRuntime.run()
  -> load state
  -> build context
  -> select model
  -> call model
  -> validate tool calls
  -> execute tools
  -> persist observations
  -> enforce budget
  -> continue/replan/finalize
```

Add:

- maximum iterations
- maximum tool calls
- maximum wall-clock duration
- maximum token/cost budget
- cancellation checks
- duplicate tool-call protection
- tool timeout handling
- retry policy for transient tool failures
- explicit terminal states
- resumability from persisted state
- deterministic run/step IDs

### B2. Correct the current loop semantics

The current loop rebuilds a single context snapshot and passes a separate results array into each model round. Change this to a true conversation/state history where the model receives the original request plus prior assistant tool-call messages and tool-result observations in provider-neutral form.

Do not keep only the latest generated text. The runtime must preserve the full operational sequence required to continue the task.

### B3. Parallel tool calls

Support parallel execution only when the model requests independent calls and the tool metadata declares the operation safe to parallelize. Default to sequential execution for write operations.

## 6. Workstream C — Unified Tool Registry

### C1. Upgrade `packages/ai-agent/src/tool-registry.ts`

Extend `RegisteredTool` with metadata:

```text
name
namespace
version
description
inputSchema
outputSchema
risk
readOnly
idempotent
supportsParallel
timeoutMs
requiredScopes
source
```

### C2. Server-side validation

Before every call:

```text
model tool call
 -> tool exists
 -> schema validation
 -> tenant/workspace scope validation
 -> user permission validation
 -> connection validation
 -> risk/approval policy
 -> execute
```

Reject invalid calls before reaching a Piece or external provider.

### C3. Tool discovery

Add filtered discovery by:

- workspace/project
- connected apps
- user permissions
- agent allow-list
- operation type
- risk level

The model should receive only tools it can actually use.

## 7. Workstream D — Convert existing Pieces into agent tools

The integration framework is already the correct source for application capabilities.

Create a Piece-to-agent adapter that derives normalized tool definitions from existing Piece actions/triggers/search operations.

Example:

```text
Google Calendar Piece
  -> calendar.list_events
  -> calendar.get_event
  -> calendar.create_event
  -> calendar.update_event
  -> calendar.delete_event
```

Likewise for WhatsApp, Shopify, Google Sheets, Gmail, Slack, Calendly, Zoom, and future Pieces.

Requirements:

- use existing connection IDs
- resolve credentials server-side
- never put secrets in tool definitions
- preserve Piece validation schemas
- normalize provider errors
- expose safe output schemas
- enforce tenant/project ownership

## 8. Workstream E — MCP integration

Connect the existing MCP service to the same `AgentToolRegistry` abstraction.

Target:

```text
Agent Tool Registry
  |-- Native Piece tools
  |-- Workflow tools
  |-- MCP tools
  |-- Generic HTTP tools
  |-- Internal platform tools
```

MCP tools must inherit the same:

- tenant scope
- permission checks
- connection resolution
- schema validation
- timeout
- retry
- audit/observability
- budget controls

The agent should not care whether a tool came from a Piece or MCP.

## 9. Workstream F — Model Gateway

### F1. Use `packages/ai` as the model abstraction

Keep provider-specific HTTP code out of `packages/ai-agent`.

Create a normalized model interface:

```text
respond(messages, tools, config)
stream(messages, tools, config)
```

Provider adapters should normalize:

- text output
- tool calls
- structured JSON
- usage
- finish reason
- provider errors
- streaming deltas

### F2. Model routing

Implement a `ModelRouter` capable of choosing a provider/model by task:

- fast conversational response
- workflow planning
- structured extraction
- complex agent execution
- voice response
- embeddings

Support OpenAI, Anthropic, Google, Groq, and future providers through adapters. Provider choice must be configuration, not hardcoded application logic.

### F3. Streaming

Streaming must work at the agent level, not only the raw model level:

```text
agent event: started
agent event: planning
agent event: tool_started
agent event: tool_completed
agent event: response_delta
agent event: completed
```

Expose these events through the existing API transport used by the UI/voice surfaces.

## 10. Workstream G — Context system

### G1. Extend `packages/ai-agent/src/context.ts`

Keep the current safe connection metadata behavior and add structured context sections:

```text
identity
workspace
project
current flow
current flow version
selected node
available integrations
available connections
permissions
recent executions
conversation
agent memory references
retrieved knowledge
current variables
```

### G2. Context budget

Context must be assembled by priority rather than dumping the entire database/workflow into the model.

Priority:

1. current user request
2. current selected workflow/node
3. relevant previous conversation
4. required tool schemas
5. relevant execution state
6. relevant memory/RAG results
7. broader workspace metadata

## 11. Workstream H — Memory and RAG

Implement separate stores for different purposes:

### Short-term conversation memory

Recent messages and tool observations for the active session.

### Long-term agent/user memory

Explicit durable facts/preferences that are useful across sessions.

### Knowledge/RAG

Embeddings and retrieved business/document knowledge.

Do not use one vector store as a substitute for operational agent state.

The runtime should retrieve memory/RAG before model execution and record which memory references influenced a run.

## 12. Workstream I — Planning and replanning

Add optional planning mode for tasks that require multiple operations.

```text
Goal
 -> Plan
 -> Execute step
 -> Observe
 -> Evaluate
 -> Continue or Replan
 -> Finish
```

Planning must not become an uncontrolled reasoning transcript. Store structured plan items such as:

```text
stepId
objective
tool candidates
status
result reference
retry count
```

The runtime should re-plan after meaningful failures or changed observations rather than blindly retrying the same action.

## 13. Workstream J — Permissions, risk and approvals

Introduce tool risk metadata:

```text
read      = low
write     = medium
external_send = high
bulk_send = critical
delete    = critical
```

Default policy:

- reads can execute when authorized
- normal writes require authorization but can execute automatically
- bulk/destructive/high-impact operations can require human approval

Approval state must be durable and resume the exact agent run from the paused tool step.

## 14. Workstream K — Worker/queue integration

Do not run long autonomous agents entirely inside a synchronous HTTP request.

Target:

```text
API
 -> create agent_run
 -> BullMQ job
 -> worker
 -> AgentRuntime
 -> tool execution
 -> persist state
 -> requeue/resume if necessary
```

Use Redis/BullMQ for:

- asynchronous agent runs
- retries
- delayed resume
- approval resume
- long-running tools
- concurrency limits
- cancellation

Synchronous chat can use the same runtime for short tasks while enforcing a strict time budget.

## 15. Workstream L — Workflow/Agent bridge

Add two controlled capabilities:

### Workflow -> Agent

An AI Agent node invokes the runtime with:

- goal/prompt
- model
- allowed tools
- max iterations
- budget
- memory mode
- approval policy

The agent returns structured output to downstream workflow nodes.

### Agent -> Workflow

Expose published workflows as callable tools where permitted:

```text
workflow.run
```

The agent receives only the workflow's public input schema and safe output schema.

Never allow an agent to silently publish or mutate a production workflow unless an explicit authorized operation permits it.

## 16. Workstream M — Copilot integration

The current Copilot system prompt already defines safe workflow behavior. Keep it, but move execution to the same AgentRuntime.

Copilot modes should become:

```text
answer
build
edit
configure
test
explain
debug
agent
```

For `build`:

```text
user idea
 -> understand
 -> discover integrations
 -> inspect connections
 -> generate structured plan
 -> Plan & Review
 -> approve/build
 -> draft workflow
 -> validate
 -> editor
```

For `agent`:

```text
user goal
 -> agent runtime
 -> tools
 -> observations
 -> final result
```

The same tools and authorization boundary should power both.

## 17. Workstream N — Voice, chat and channel reuse

Do not create a separate autonomous-agent implementation for voice.

Use:

```text
Voice STT
 -> AgentRuntime
 -> tool loop
 -> streamed response
 -> TTS
```

The same runtime should be reusable from:

- dashboard chat
- workflow AI Agent step
- WhatsApp agent
- voice agent
- API
- MCP client

Only the transport/channel layer changes.

## 18. Workstream O — Database changes

Add migrations for durable agent state. Recommended tables/entities:

```text
agents
agent_versions
agent_sessions
agent_runs
agent_messages
agent_steps
agent_tool_calls
agent_observations
agent_plans
agent_memory
agent_memory_items
agent_approvals
agent_evaluations
```

Every record must carry tenant/workspace ownership where applicable.

Indexes should cover:

- workspace + agent
- session + created_at
- run + sequence
- status + updated_at
- approval status
- active/resumable runs

Use JSONB for provider-neutral payloads where schemas legitimately vary, while keeping IDs/status/timestamps/counters as typed columns.

## 19. Workstream P — Observability

Every run must produce a traceable operational timeline:

```text
run created
context loaded
model request
model response
tool requested
tool authorized
tool started
tool completed
tool failed
approval requested
run resumed
run completed
```

Capture:

- latency
- provider/model
- token usage
- estimated cost
- tool latency
- retry count
- failure code
- final status

Redact secrets and sensitive fields before persistence/logging.

## 20. Workstream Q — Error handling

Normalize errors into categories:

```text
MODEL_AUTH_ERROR
MODEL_RATE_LIMIT
MODEL_TIMEOUT
INVALID_MODEL_OUTPUT
INVALID_TOOL_CALL
UNKNOWN_TOOL
TOOL_VALIDATION_ERROR
CONNECTION_EXPIRED
PERMISSION_DENIED
APPROVAL_REQUIRED
TOOL_TIMEOUT
TOOL_TRANSIENT_FAILURE
TOOL_PERMANENT_FAILURE
BUDGET_EXCEEDED
AGENT_TIMEOUT
CANCELLED
```

The model should receive safe, actionable tool errors so it can recover or ask the user a focused question.

Never return raw provider credentials, stack traces, or internal database details to the user/model.

## 21. Workstream R — Agent evaluation and testing

Create deterministic test scenarios before enabling broad autonomous actions.

### Core tests

1. Answer-only request — no tool call.
2. One read tool — calendar/list/search.
3. Multi-tool task — search -> inspect -> write.
4. Tool failure -> recovery.
5. Tool failure -> replan.
6. Missing connection -> focused question.
7. Permission denied -> no execution.
8. Approval-required operation -> pause/resume.
9. Budget exhaustion -> safe termination.
10. Worker restart -> run resumes.
11. Duplicate event -> idempotency prevents duplicate side effect.
12. MCP tool and Piece tool behave identically through the registry.
13. Workflow agent node returns structured output to downstream node.
14. Voice streaming receives incremental agent events.
15. Secrets never appear in model context or logs.

### End-to-end acceptance scenarios

**Calendar:**
"Check my calendar tomorrow and schedule a meeting with John if 3 PM is free."

Expected behavior:

```text
calendar.list_events
 -> inspect availability
 -> calendar.create_event (only if free)
 -> verify result
 -> concise response
```

**Shopify + WhatsApp:**
"Find customers who purchased Product X this month and prepare a WhatsApp message for them."

Expected behavior:

```text
shopify.search_orders
 -> extract/deduplicate customers
 -> enforce WhatsApp eligibility
 -> draft message
 -> require approval before bulk send
```

## 22. Implementation order

### Phase 0 — Baseline and safety

- inventory current AI/Copilot call paths
- identify duplicate/legacy AI execution paths
- establish canonical runtime entry point
- add regression tests around current Copilot behavior
- do not change UI

### Phase 1 — Agent core

- extend types
- durable run state
- AgentRuntime
- state machine
- budget/cancellation
- corrected multi-round message/tool history
- tool validation

### Phase 2 — Unified tools

- upgrade registry metadata
- Piece adapters
- workflow tools
- MCP adapters
- permission/risk checks
- normalized errors

### Phase 3 — Model gateway

- provider-neutral model interface
- provider adapters
- model router
- structured output
- tool-call normalization
- streaming

### Phase 4 — Worker integration

- BullMQ agent jobs
- durable resume
- retries/delays
- cancellation
- concurrency controls

### Phase 5 — Memory/context

- conversation memory
- long-term memory
- RAG retrieval
- context budgeting

### Phase 6 — Planning and human control

- structured plans
- replanning
- approvals
- high-risk policies

### Phase 7 — Product integration

- Copilot
- AI Agent workflow node
- chat
- voice
- WhatsApp/channel agents
- callable workflows

### Phase 8 — Evaluation/production hardening

- end-to-end test suite
- load tests
- failure injection
- cost controls
- tracing/dashboard
- security audit

## 23. File-level change map

### Existing files to evolve

```text
packages/ai-agent/src/types.ts
packages/ai-agent/src/context.ts
packages/ai-agent/src/loop.ts
packages/ai-agent/src/tool-registry.ts
packages/ai-agent/src/tool-adapters.ts
packages/ai-agent/src/system-prompt.ts
packages/ai-agent/src/index.ts
packages/ai/src/index.ts
```

### New runtime files recommended

```text
packages/ai-agent/src/runtime.ts
packages/ai-agent/src/state-machine.ts
packages/ai-agent/src/model-router.ts
packages/ai-agent/src/tool-policy.ts
packages/ai-agent/src/tool-executor.ts
packages/ai-agent/src/budget.ts
packages/ai-agent/src/memory.ts
packages/ai-agent/src/planner.ts
packages/ai-agent/src/stream.ts
packages/ai-agent/src/errors.ts
packages/ai-agent/src/events.ts
packages/ai-agent/src/redaction.ts
```

### DB layer

```text
packages/db/...
  agent repositories
  agent run persistence
  memory repositories
  approval persistence
  evaluation persistence
```

### API

Add/extend endpoints for:

```text
POST   /agents/:agentId/runs
GET    /agents/:agentId/runs/:runId
POST   /agents/:agentId/runs/:runId/cancel
POST   /agents/:agentId/runs/:runId/resume
GET    /agents/:agentId/runs/:runId/events
POST   /agents/:agentId/runs/:runId/approvals/:approvalId
```

Exact route names should follow the repository's existing API conventions rather than introducing a second routing style.

### Worker

Add an agent job processor that calls the same `AgentRuntime` used by synchronous/API entry points.

### Python AI service

Keep Python responsible for model/inference operations where configured. It should not own tenant authorization, credential resolution, direct database mutation, or Piece execution.

## 24. Definition of done

The agent upgrade is complete only when all of the following are true:

- A user can provide a goal rather than a fixed workflow sequence.
- The agent can select from authorized connected-app tools.
- The agent can execute multiple sequential tool calls.
- Tool results are returned to the model as structured observations.
- The agent can recover from transient tool failures.
- The agent can re-plan when observations invalidate the previous plan.
- Agent state survives worker restart/retry.
- Tool calls are tenant/user scoped and schema validated.
- Secrets never reach the model/browser/logs.
- High-risk operations can pause for approval and resume.
- Agent runs have hard iteration, tool, time, token, and cost limits.
- Model providers are swappable behind one interface.
- Piece and MCP tools share one registry/execution boundary.
- Copilot uses the same runtime rather than a separate implementation.
- Workflow AI Agent steps use the same runtime.
- Voice/chat/channel agents use the same runtime.
- Agent execution is observable and auditable.
- Existing workflow execution remains deterministic and unaffected.
- Existing frontend continues to function without unnecessary UI rewrites.

## 25. Final target

The desired end state is not a replacement of MainAutomation with a generic agent framework. It is a unified platform in which the existing automation engine becomes the deterministic execution layer and the new AgentRuntime becomes the goal-oriented decision layer:

```text
                         Algoverge
                            |
             +--------------+--------------+
             |                             |
      Automation Engine              Agent Runtime
             |                             |
     deterministic graph          goal -> observe -> act
             |                             |
             +--------------+--------------+
                            |
                     Unified Tool Layer
                            |
                +-----------+-----------+
                |           |           |
              Pieces       MCP       Workflows
                |           |           |
                +-----------+-----------+
                            |
                  Existing Connections
                            |
                  Existing DB / Redis
                            |
              OpenAI / Anthropic / Gemini
                    / Groq / other models
```

This preserves the investment already present in MainAutomation while making the agent a real autonomous runtime instead of a single LLM response step.
