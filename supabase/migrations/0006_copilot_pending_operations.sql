-- Store validated AgentOperations on the copilot session so the approve
-- endpoint can re-validate them against the current workflow at approval
-- time.  NULL means no pending operations (e.g. auto-applied or no-op).
ALTER TABLE public.copilot_sessions
  ADD COLUMN IF NOT EXISTS pending_operations JSONB;
