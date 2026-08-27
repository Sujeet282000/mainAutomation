-- Durable execution cursor used by the canonical worker/engine boundary.
-- Existing automation/execution tables are intentionally untouched for UI/API compatibility.

ALTER TABLE public.flow_runs
  ADD COLUMN IF NOT EXISTS cursor INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_flow_runs_status_cursor
  ON public.flow_runs (status, cursor, created_at);
