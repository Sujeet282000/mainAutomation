-- Trigger activation upserts with ON CONFLICT (flow_id) WHERE status = 'active',
-- which PostgreSQL only accepts when a matching partial unique index exists.
-- Without it, activation throws and publishing silently skips trigger
-- registration (no webhook tokens, no cron schedules).
CREATE UNIQUE INDEX IF NOT EXISTS triggers_registry_flow_active_key
  ON public.triggers_registry (flow_id) WHERE status = 'active';
