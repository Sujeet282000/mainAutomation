# Locked initial stack

This repo uses only TypeScript, SQL, and Python.

| Layer | Technology |
| --- | --- |
| Frontend | Next.js + TypeScript |
| UI | Tailwind CSS + shadcn-style components |
| Workflow builder | React Flow |
| State | Zustand + TanStack Query |
| Forms | React Hook Form + Zod |
| Backend | Node.js + TypeScript + Express |
| Database | Supabase PostgreSQL (Docker Postgres locally) |
| Auth | JWT today; Supabase Auth when `SUPABASE_*` is set |
| DB security | RLS policies in `supabase/migrations/002_rls.sql` |
| Files | Supabase Storage (bucket wiring in Phase 4) |
| Realtime | Supabase Realtime (execution channel in Phase 2) |
| Queue | Redis + BullMQ |
| Workers | Node.js + TypeScript |
| AI | Python + FastAPI |
| Payments | Stripe (env + webhook route stub) |
| Email | Resend |
| Monitoring | Sentry DSN |
| Deploy | Vercel (web) + Render/Fly/AWS (api/worker) |
| DNS | Cloudflare |

API and workers must use a privileged DB role (`DATABASE_URL` / Supabase service role). Browser clients never receive service-role keys.
