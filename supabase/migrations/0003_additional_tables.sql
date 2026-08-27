-- =============================================================================
-- Orchestra — Additional tables for Part 6 runtime and Part 8 copilot
-- These tables were referenced in the document but missing from the initial migration.
-- =============================================================================

-- trigger_state: key-value store for trigger lifecycle (e.g., webhook event filters)
CREATE TABLE IF NOT EXISTS public.trigger_state (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  trigger_registry_id UUID NOT NULL,
  key               TEXT NOT NULL,
  value_json        JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (trigger_registry_id) REFERENCES public.triggers_registry(id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, trigger_registry_id) REFERENCES public.triggers_registry(id, flow_id) ON DELETE CASCADE,
  UNIQUE (trigger_registry_id, key)
);

-- queue_jobs: fallback queue when Redis is unavailable (dev/test only)
CREATE TABLE IF NOT EXISTS public.queue_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name        TEXT NOT NULL DEFAULT 'default',
  payload           JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'delayed')),
  org_id            UUID,
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  locked_by         TEXT,
  locked_at         TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  failed_at         TIMESTAMPTZ,
  error_json        JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_queue_jobs_status ON public.queue_jobs (status, created_at)
  WHERE status = 'pending';

-- webhooks: inbound webhook configuration per trigger
CREATE TABLE IF NOT EXISTS public.webhooks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  trigger_id        UUID NOT NULL,
  token             TEXT NOT NULL UNIQUE,
  secret_hash       BYTEA,
  url               TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  last_received_at  TIMESTAMPTZ,
  event_count       INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (trigger_id) REFERENCES public.triggers_registry(id) ON DELETE CASCADE,
  UNIQUE (org_id, trigger_id)
);

-- api_keys: programmatic access keys
CREATE TABLE IF NOT EXISTS public.api_keys (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  user_id           UUID NOT NULL,
  name              TEXT NOT NULL,
  key_prefix        TEXT NOT NULL,
  key_hash          TEXT NOT NULL,
  scopes            TEXT[] NOT NULL DEFAULT '{*}',
  revoked_at        TIMESTAMPTZ,
  last_used_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

-- mcp_tokens: Model Context Protocol tokens for AI assistants
CREATE TABLE IF NOT EXISTS public.mcp_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  user_id           UUID NOT NULL,
  name              TEXT NOT NULL,
  token_prefix      TEXT NOT NULL,
  token_hash        TEXT NOT NULL,
  scopes            TEXT[] NOT NULL DEFAULT '{flows:read,flows:write}',
  revoked_at        TIMESTAMPTZ,
  last_used_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

-- webhook_events: log of inbound webhook deliveries
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  public_id         TEXT NOT NULL UNIQUE,
  trigger_id        UUID,
  event_id          TEXT,
  body              JSONB,
  headers           JSONB,
  processing_status TEXT NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received', 'processing', 'processed', 'failed', 'deduplicated')),
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  error_message     TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_org ON public.webhook_events (org_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON public.webhook_events (event_id) WHERE event_id IS NOT NULL;

-- Extend copilot_sessions with proposal storage
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'copilot_sessions' AND column_name = 'proposed_definition'
  ) THEN
    ALTER TABLE public.copilot_sessions ADD COLUMN proposed_definition JSONB;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'copilot_sessions' AND column_name = 'flow_id'
  ) THEN
    ALTER TABLE public.copilot_sessions ADD COLUMN flow_id UUID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'copilot_sessions' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE public.copilot_sessions ADD COLUMN project_id UUID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'copilot_sessions' AND column_name = 'mode'
  ) THEN
    ALTER TABLE public.copilot_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto_build';
  END IF;
END $$;

-- Add flow_id to todos if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'todos' AND column_name = 'flow_id'
  ) THEN
    ALTER TABLE public.todos ADD COLUMN flow_id UUID;
  END IF;
END $$;

-- Add password_hash to users if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'password_hash'
  ) THEN
    ALTER TABLE public.users ADD COLUMN password_hash TEXT;
  END IF;
END $$;

-- RLS policies for new tables
ALTER TABLE public.trigger_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- trigger_state: member read, service write
CREATE POLICY trigger_state_member_read ON public.trigger_state
  FOR SELECT USING (org_id = current_setting('request.org_id', true)::uuid);

-- api_keys: owner read
CREATE POLICY api_keys_member_read ON public.api_keys
  FOR SELECT USING (org_id = current_setting('request.org_id', true)::uuid);

-- mcp_tokens: owner read
CREATE POLICY mcp_tokens_member_read ON public.mcp_tokens
  FOR SELECT USING (org_id = current_setting('request.org_id', true)::uuid);

-- webhook_events: member read
CREATE POLICY webhook_events_member_read ON public.webhook_events
  FOR SELECT USING (org_id = current_setting('request.org_id', true)::uuid);

ALTER TABLE public.flow_runs
  DROP CONSTRAINT IF EXISTS flow_runs_id_created_org;
ALTER TABLE public.flow_runs
  ADD CONSTRAINT flow_runs_id_created_org UNIQUE (id, created_at, org_id);

CREATE TABLE IF NOT EXISTS public.oauth_states (
  state         TEXT PRIMARY KEY,
  user_id       UUID NOT NULL,
  org_id        UUID NOT NULL,
  app_slug      TEXT NOT NULL,
  redirect_to   TEXT,
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.workspace_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('agent','chatbot','canvas','interface')),
  name TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workspace_items_org_kind ON public.workspace_items (org_id, kind);
