# Copilot Evals

Permanent test dataset for Copilot regression testing.

Every Copilot change must run these tests. A new model/prompt must not silently break previously working requests.

## Structure

Each eval file contains:
- `input`: The natural language request
- `expected`: The expected AutomationPlan shape (app slugs, operation keys, step count, connections needed)
- `category`: Test category for filtering

## Categories

- `gmail/` — Gmail trigger/action requests
- `sheets/` — Google Sheets operations
- `slack/` — Slack notifications
- `multi-app/` — Requests spanning multiple apps
- `conditions/` — Conditional branching
- `editing/` — Modifying existing workflows
- `ambiguous/` — Ambiguous requests that need clarification
- `unsupported/` — Requests for apps without live adapters

## Running

```bash
npx tsx --test src/copilot-evals/runner.ts
```
