-- Compatibility linkage while legacy executions are still being drained.
ALTER TABLE public.trigger_events
  ADD COLUMN IF NOT EXISTS legacy_execution_id UUID;

CREATE INDEX IF NOT EXISTS idx_trigger_events_legacy_execution
  ON public.trigger_events (legacy_execution_id)
  WHERE legacy_execution_id IS NOT NULL;
