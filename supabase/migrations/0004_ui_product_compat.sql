-- Product surfaces used by the existing Orchestra UI (agents, forms, folders, etc.)
-- keyed by org_id so they sit on the new tenancy model.

CREATE TABLE IF NOT EXISTS public.hosted_forms (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id     UUID,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL,
  fields         JSONB NOT NULL DEFAULT '[]'::jsonb,
  table_id       UUID,
  automation_id  UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS public.form_submissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  form_id     UUID NOT NULL REFERENCES public.hosted_forms(id) ON DELETE CASCADE,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.automation_folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID,
  name        TEXT NOT NULL,
  parent_id   UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  organization_id    UUID,
  workspace_id       UUID,
  name               TEXT NOT NULL,
  instructions       TEXT NOT NULL DEFAULT '',
  knowledge          TEXT NOT NULL DEFAULT '',
  model              TEXT NOT NULL DEFAULT 'openai:gpt-4o-mini',
  pod                TEXT,
  automation_id      UUID,
  tools              JSONB NOT NULL DEFAULT '[]'::jsonb,
  trigger_mode       TEXT NOT NULL DEFAULT 'manual',
  approval_required  BOOLEAN NOT NULL DEFAULT false,
  max_actions        INTEGER NOT NULL DEFAULT 8,
  status             TEXT NOT NULL DEFAULT 'active',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id  UUID,
  agent_id      UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  app_slug      TEXT NOT NULL,
  operation     TEXT NOT NULL,
  input         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending',
  decided_by    UUID,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_activities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id      UUID,
  organization_id   UUID,
  type              TEXT NOT NULL DEFAULT 'run',
  input             JSONB,
  output            JSONB,
  cost              INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'ok',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chatbots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  instructions    TEXT NOT NULL DEFAULT '',
  knowledge       TEXT NOT NULL DEFAULT '',
  keyword         TEXT,
  automation_id   UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS public.canvases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  graph       JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.interfaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  pages       JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_public   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS public.workspace_ai_settings (
  workspace_id          UUID PRIMARY KEY,
  org_id                UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ai_enabled            BOOLEAN NOT NULL DEFAULT true,
  agents_enabled        BOOLEAN NOT NULL DEFAULT true,
  chatbots_enabled      BOOLEAN NOT NULL DEFAULT true,
  pii_filter            BOOLEAN NOT NULL DEFAULT true,
  monthly_activity_cap  INTEGER NOT NULL DEFAULT 400
);

CREATE TABLE IF NOT EXISTS public.oauth_states (
  state         TEXT PRIMARY KEY,
  user_id       UUID NOT NULL,
  org_id        UUID NOT NULL,
  app_slug      TEXT NOT NULL,
  redirect_to   TEXT,
  expires_at    TIMESTAMPTZ NOT NULL
);
