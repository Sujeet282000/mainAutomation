-- Product-surface tables referenced by modules/products.ts (developer apps,
-- transfers, email parsers). Without them the Developer page and SDK surface
-- 500 even with the router mounted.
CREATE TABLE IF NOT EXISTS public.developer_apps (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL,
  client_id          TEXT NOT NULL,
  client_secret_hash TEXT NOT NULL,
  manifest           JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT NOT NULL DEFAULT 'active',
  visibility         TEXT NOT NULL DEFAULT 'private',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_developer_apps_org ON public.developer_apps (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.transfer_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID,
  organization_id UUID,
  name            TEXT NOT NULL,
  source          JSONB NOT NULL DEFAULT '{}'::jsonb,
  destination     JSONB NOT NULL DEFAULT '{}'::jsonb,
  mapping         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'pending',
  last_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transfer_jobs_ws ON public.transfer_jobs (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.email_parsers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID,
  organization_id UUID,
  name            TEXT NOT NULL,
  mailbox         TEXT NOT NULL,
  template        JSONB NOT NULL DEFAULT '{"fields":[]}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_parsers_ws ON public.email_parsers (workspace_id, created_at DESC);
