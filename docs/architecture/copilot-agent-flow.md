# Copilot Agent Runtime

## Runtime

1. Next.js Copilot panel sends the existing refinement request.
2. Node API authenticates the workspace and owns durable workflow state.
3. Python `/copilot/refine` first invokes the conversational agent for ordinary questions.
4. If the agent returns no operations, the existing draft is preserved and the response is returned directly.
5. If the request is a workflow mutation, the existing orchestrator remains the mutation path and returns a draft, never a published workflow.
6. Python model access is provider-neutral through the AI gateway.

## Boundaries

- Python may reason and propose explicit operations; it never writes the database or stores credentials.
- Node remains the authorization and persistence boundary.
- Existing catalog/engine integrations remain the source of truth for available operations.
- The frontend keeps the existing Copilot UI and receives a normal reply for non-mutating questions.

## Agent roadmap

The agent contract in `packages/ai-agent` is the provider-neutral multi-round tool layer. The next migration can bind its workflow/integration/execution tools directly to Node domain services. Until those bindings are complete, the existing orchestrator remains the compatibility path for mutations.
