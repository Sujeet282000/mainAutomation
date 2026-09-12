-- Forms file storage: durable, org-scoped file store for form file fields.
-- Files are stored base64-inline in JSONB with a hard cap enforced in the API
-- (MAX_FORM_FILE_BYTES). Bytes never reach the API heap —
-- payload size is bounded by the JSON body limit before parse.

CREATE TABLE IF NOT EXISTS public.form_files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  form_id      UUID,           -- data_tables row of the form (form:%)
  submission_id UUID,          -- data_table_rows id, set after insert
  field_key    TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes   INTEGER NOT NULL CHECK (size_bytes >= 0),
  content_b64  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_files_submission
  ON public.form_files (org_id, submission_id);

CREATE INDEX IF NOT EXISTS idx_form_files_form
  ON public.form_files (org_id, form_id, created_at DESC);
