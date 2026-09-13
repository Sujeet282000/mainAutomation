# Algoverge Automate

Multi-tenant workflow automation platform with a Next.js UI, Node.js control-plane API, queue-based workers, scheduler, PostgreSQL/Supabase, Redis/BullMQ, and a Python AI service.

## Repository layout

```text
apps/
  web/        Next.js frontend and existing product UI
  api/        Node.js/Express control-plane API (Express is the actual framework — see PROJECT.md)
  worker/     BullMQ execution workers
  scheduler/  cron/poll trigger dispatcher
  ai/         Python/FastAPI AI service
  mcp/        MCP service

packages/
  engine/     workflow execution runtime
  db/         database access and repositories
  core/       shared domain logic
  crypto/     credential/security utilities
  validation/ shared validation
  observability/ logging and telemetry
  shared/     shared contracts/utilities
  types/      shared TypeScript types
  pieces*/    integration framework and SDK

docs/
  architecture/  active architecture and implementation specification
  research/     product/integration research
```

## Local setup

```bash
cp .env.example .env
docker compose up -d
npm install
npm run migrate
npm run seed
npm run dev
```

Services:

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- API health: `http://localhost:4000/health`
- AI: `http://localhost:8000`
- Redis: `localhost:6379`

## Service commands

```bash
npm run dev:web
npm run dev:api
npm run dev:worker
npm run dev:scheduler
npm run dev:ai
```

## Runtime model

```text
Next.js
   ↓
API / control plane
   ↓
Redis / BullMQ
   ↓
Worker fleet
   ↓
packages/engine
   ↓
DB + integration adapters

Scheduler
   ↓
API scheduler dispatcher
   ↓
Redis / BullMQ

Worker / Engine
   ↓
Python AI service when an AI operation is required
```

Published automation versions are immutable execution inputs. Connections and credentials remain server-side and are not returned to the browser.

## Architecture source of truth

See `docs/architecture/Automation_Platform_Production_Specification.md` for the complete product and engineering specification and `docs/architecture/target-architecture.md` for the current service-boundary target.

## Development notes

Do not commit `.env`, generated TypeScript build info, local IDE/worktree metadata, logs, or temporary repository inspection files. Keep the existing UI; backend changes should preserve its API-facing behavior unless a deliberate contract migration is documented.