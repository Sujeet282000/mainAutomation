-- Durable agent runtime: persistent runs and per-round event trails.
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID NOT NULL,
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id     UUID,
  status           TEXT NOT NULL DEFAULT 'running',
  input_message    TEXT NOT NULL DEFAULT '',
  reply            TEXT NOT NULL DEFAULT '',
  rounds           INTEGER NOT NULL DEFAULT 0,
  stop_reason      TEXT NOT NULL DEFAULT '',
  model            TEXT NOT NULL DEFAULT '',
  usage            JSONB NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0}'::jsonb,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_created
  ON public.agent_runs (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status
  ON public.agent_runs (workspace_id, status);

CREATE TABLE IF NOT EXISTS public.agent_run_events (
  id         BIGSERIAL PRIMARY KEY,
  run_id     UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  type       TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_agent_run_events_run
  ON public.agent_run_events (run_id, seq);
