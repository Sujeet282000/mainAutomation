-- Some development databases recorded 0003 as applied before its auth column
-- was present. Keep this forward-only repair idempotent for those databases.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS password_hash TEXT;
