-- Canonical trigger envelope claim table.
-- A separate non-partitioned claim table gives all trigger sources one
-- tenant-scoped uniqueness boundary, including partitioned flow_runs.
CREATE TABLE IF NOT EXISTS public.trigger_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  automation_id UUID NOT NULL,
  version_id UUID,
  event_id TEXT,
  trigger_type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  flow_run_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_trigger_events_automation_created
  ON public.trigger_events (automation_id, created_at DESC);

ALTER TABLE public.trigger_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trigger_events_service_only ON public.trigger_events;
CREATE POLICY trigger_events_service_only ON public.trigger_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
