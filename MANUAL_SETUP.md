# Manual setup (you must create these)

Code can migrate the database and run the app. It cannot create vendor accounts. Create each item below, then paste values into `.env`.

## Always required for local

| Item | Where | Env vars |
| --- | --- | --- |
| Docker Desktop | docker.com | — |
| Node.js 20+ | nodejs.org | — |
| Postgres + Redis | `docker compose up -d` | `DATABASE_URL`, `REDIS_URL` |
| JWT / encryption secrets | generate locally | `JWT_SECRET`, `ENCRYPTION_KEY`, `WEBHOOK_SECRET` |

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Production database (recommended)

| Item | Where | Env vars |
| --- | --- | --- |
| Supabase project | supabase.com | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` |

Use the **service role** only on the API/worker. Never expose it to Next.js.

## Billing

| Item | Where | Env vars |
| --- | --- | --- |
| Stripe account | dashboard.stripe.com | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` |
| Stripe webhook | Developers → Webhooks → `https://<api>/api/v1/webhooks/stripe` | `STRIPE_WEBHOOK_SECRET` |
| Products / prices | Stripe Products | `STRIPE_PRICE_*` |

## Google (Gmail, Calendar, Sheets, Drive, Docs)

| Item | Where |
| --- | --- |
| Google Cloud project | console.cloud.google.com |
| Enable APIs | Gmail, Calendar, Sheets, Drive, Docs |
| OAuth consent screen | External or Internal |
| OAuth client (Web) | Authorized redirect: `GOOGLE_REDIRECT_URI` |

Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`

One platform OAuth client is enough. Each customer connection stores **their** refresh token encrypted.

## Microsoft (Outlook, Excel, Teams)

Azure App Registration → Web redirect `MICROSOFT_REDIRECT_URI` → Graph permissions (Mail, Calendars, Files).

Env: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`

## Meta / WhatsApp Cloud API

| Item | Where |
| --- | --- |
| Meta developer app | developers.facebook.com |
| WhatsApp product | add to the app |
| Business / phone number | WhatsApp Manager |
| Webhook | `https://<api>/api/v1/webhooks/whatsapp` verify token `WHATSAPP_WEBHOOK_VERIFY_TOKEN` |

Env: `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`

## Other OAuth apps

| App | Console | Env |
| --- | --- | --- |
| Slack | api.slack.com/apps | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` |
| GitHub | GitHub → Developer settings → OAuth Apps | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| HubSpot | developers.hubspot.com | `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` |
| Salesforce | Setup → App Manager → Connected App | `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET` |

## AI

| Provider | Env |
| --- | --- |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` |

Without these keys, AI steps fail closed with a clear error. The copilot still returns a draft graph.

## Email

Resend / SendGrid / Postmark → `RESEND_API_KEY`, `EMAIL_FROM`

## MCP / AI clients

| Item | Where |
| --- | --- |
| Algoverge MCP token | In-app **Settings** after local login |
| Supabase MCP | supabase.com PAT + project ref — [docs/MCP.md](./docs/MCP.md) |

| Item | Notes |
| --- | --- |
| Sentry | `SENTRY_DSN` |
| Vercel | Next.js web |
| Render / Fly / AWS | API + worker services |
| Upstash / Redis Cloud | production Redis |
| Cloudflare | DNS |

## Automated vs manual

**Automated by this repo:** schema, RLS-ready tenant columns, seed plans/apps/templates, local Docker Postgres/Redis, migrate/seed scripts.

**Manual forever:** cloud accounts, OAuth clients, webhook URLs on public HTTPS, DNS, paid Stripe products.

Full env table: [docs/ENVIRONMENT.md](./docs/ENVIRONMENT.md).
