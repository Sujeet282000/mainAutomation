# Runtime Contracts

## Execution job

```ts
{
  executionId: string
}
```

The queue carries an execution identifier, not a complete workflow payload. The worker resolves the immutable published version from persistence through the engine.

## Lifecycle

```text
queued -> running -> completed
                 \-> failed
                 \-> waiting
                 \-> cancelled
```

## Service boundaries

API creates and queues runs. Scheduler discovers due work. Worker consumes jobs. Engine executes workflow semantics. Integrations perform external operations. DB owns durable state.

## AI boundary

Node/API or engine requests an AI operation from Python using a versioned JSON contract. Python returns structured output/errors; it does not mutate workflow lifecycle state directly.

## Integration boundary

An integration exposes metadata, authentication, triggers, actions, searches, webhook handling, and connection testing. The engine invokes an integration operation through the framework rather than importing provider-specific code.

## Frontend boundary

The web app consumes API DTOs and schemas. It must not access database credentials, Redis, provider secrets, or integration SDK internals.
