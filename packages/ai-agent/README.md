# AI Agent / Copilot Contract

This package defines the provider-neutral contract for the platform Copilot. It is intentionally separate from the Python model service: the Node/API layer owns authorization, workflow state and tool execution, while Python owns model/agent inference where configured.

## Runtime flow

User message -> API -> load workspace/flow context -> model -> validated tool calls -> API/domain services -> workflow draft/version -> response.

The model must never write the database directly. All mutations go through authorized domain tools. Tool results are fed back to the model so multi-step requests can continue instead of stopping after a single generated node.

## Required tool groups

- Workflow: inspect, validate, add/update/remove node, connect nodes.
- Integrations: search and retrieve trigger/action schemas.
- Connections: list available connections without exposing credentials.
- Execution: test and inspect runs/steps.

## Safety and reliability

- Scope every operation to `workspaceId` and the authenticated user.
- Never return secrets or access tokens to the model/client.
- Validate tool arguments server-side.
- Keep workflow mutations on draft versions until explicitly published.
- Return structured tool errors so the model can recover or ask a focused question.
- Preserve existing UI contracts while the backend migrates to the canonical flow/version/run model.
