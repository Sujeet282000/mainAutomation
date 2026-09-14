-- ============================================================================
-- 0024: triggers_registry timezone + webhook secret column alignment
-- The activation service stores the user's schedule timezone and the webhook
-- HMAC secret; older databases may predate these columns.
-- ============================================================================

SET search_path TO public, extensions, pg_catalog;

ALTER TABLE public.triggers_registry
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

ALTER TABLE public.triggers_registry
  ADD COLUMN IF NOT EXISTS webhook_secret_hash BYTEA;

-- Keep the schedule/polling claim queries index-friendly.
CREATE INDEX IF NOT EXISTS triggers_registry_due_idx
  ON public.triggers_registry (next_poll_at)
  WHERE enabled = true AND status = 'active';
