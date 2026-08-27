# Preview Run Doc

## How to reproduce artifacts
- `.env.local` already exists at `apps/web/.env.local` (copied during previous setup)
- Run `npm install` from the project root to install all workspace dependencies

## Services running
- **Web** (Next.js): `http://localhost:3000` — PID varies, check with `netstat -ano | grep ":3000.*LISTEN"`
- **API** (Node.js/Express): `http://localhost:4000` — run with `node node_modules/tsx/dist/cli.mjs apps/api/src/index.ts`
- **AI** (Python/FastAPI): `http://localhost:8000` — run with `cd apps/ai && python -m uvicorn main:app --reload --port 8000`
- **Database**: PostgreSQL at `localhost:54322`
- **Redis**: `localhost:6379`

## How to run the server
```bash
cd apps/web
npm run dev
```
- **Port**: 3000 (default Next.js)
- **Log**: `.freebuff/preview-*.log`
- **Detached**: Use the PowerShell detach recipe from `<preview_state>` on Windows

## Known working account
- Email: `admin2@algoverge.local`
- Password: `ChangeMe123!`
- Org: `Algoverge` (workspace ID: `9a3d9998-9362-4012-8531-fce70cf1dc3c`)

## Fixes applied (Aug 26, 2026)
1. **seed.ts table name mismatch**: Changed `organization_members` → `org_members`, removed dead `workspaces`/`workspace_members` tables
2. **oauth_states table schema**: Added `org_id` column, dropped NOT NULL on `workspace_id`, updated `ensureProductSchema` to match
3. **Copilot flow hanging**: Added 45s AbortController timeout in dashboard/AI pages, made `persistCopilotSession` fire-and-forget
4. **streamSse abort support**: Added signal abort check in the reader loop
5. **streamCopilotSession done event**: Always sends "done" event before returning (Python and Node paths)
6. **streamAiCopilotGenerate timeout**: Added 60s body-read budget to prevent infinite hang
