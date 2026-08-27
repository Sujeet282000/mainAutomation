# Environment variables

Copy `.env.example` to `.env`. Values marked **MANUAL** are created in a vendor console, not by this repo. See also [MANUAL_SETUP.md](../MANUAL_SETUP.md).

## Local runtime (required)

| Variable | Manual? | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | No (Docker) / Yes (Supabase) | Postgres for API + worker (privileged role; bypasses RLS) |
| `REDIS_URL` | No (Docker) | BullMQ |
| `JWT_SECRET` | Generate locally | Local login tokens (keep even after Supabase Auth) |
| `ENCRYPTION_KEY` | Generate locally | AES-256-GCM for connection credentials |
| `WEBHOOK_SECRET` | Generate locally | Catch-hook HMAC optional |
| `API_PORT` / `WEB_PORT` | No | Bind ports |
| `APP_URL` / `API_URL` / `NEXT_PUBLIC_API_URL` | No | CORS, OAuth redirect back to UI, browser API |
| `CORS_ORIGINS` | No | Comma-separated browser origins |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | No | Seed login |

## Auth / tenancy

| Variable | Manual? | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Project URL |
| `SUPABASE_ANON_KEY` | Yes | Browser client only (never service role) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | API/worker only |
| `SUPABASE_JWT_SECRET` | Yes | Verify Supabase JWTs when wired |

Today login is local JWT against `users.password_hash`. `users.supabase_user_id` is reserved so Supabase Auth can be attached without breaking Docker login.

## Queue / AI service

| Variable | Manual? | Purpose |
| --- | --- | --- |
| `AI_SERVICE_URL` | No | Python FastAPI (`apps/ai`), default `http://localhost:8000` |
| `STRIPE_PRICE_*` | Yes | Used by `POST /billing/checkout` when `STRIPE_SECRET_KEY` is set |

## MCP

Workspace MCP does not need extra vendor keys. Create a token in **Settings** and send `Authorization: Bearer avmcp_…` to `http://localhost:4000/mcp`.

Official **Supabase MCP** (schema/tools in Cursor) needs a Supabase personal access token and project ref — see [docs/MCP.md](./MCP.md). Do not put those values in git.

## Billing (later — you provide keys)

| Variable | Manual? |
| --- | --- |
| `STRIPE_SECRET_KEY` | Yes |
| `STRIPE_PUBLISHABLE_KEY` | Yes |
| `STRIPE_WEBHOOK_SECRET` | Yes |
| `STRIPE_PRICE_*` | Yes |

Inbound: `POST /api/v1/webhooks/stripe` starts published automations whose trigger is `stripe.new_payment`.

## Google OAuth (Gmail, Calendar, Sheets, Drive)

| Variable | Manual? |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Yes |
| `GOOGLE_CLIENT_SECRET` | Yes |
| `GOOGLE_REDIRECT_URI` | Yes — default `http://localhost:4000/api/v1/oauth/google/callback` |

## WhatsApp / Meta

| Variable | Manual? |
| --- | --- |
| `META_APP_ID` / `META_APP_SECRET` | Yes |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes |
| `WHATSAPP_ACCESS_TOKEN` | Yes |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Yes |

Inbound: `GET/POST /api/v1/webhooks/whatsapp`.

## Other OAuth / API apps

`SLACK_*`, `GITHUB_*`, `HUBSPOT_*`, `SALESFORCE_*`, `MICROSOFT_*` — all MANUAL. Connections can also store customer API keys encrypted without platform OAuth.

## LLM keys

`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` — MANUAL. Prefer storing keys on a workspace **connection**; env is fallback for the platform default.

## Email / observability

`RESEND_API_KEY`, `EMAIL_FROM`, `SENTRY_DSN` — MANUAL; unused until those adapters/services are enabled.
