-- Persisted row ordering for drag-and-drop record reordering in the Tables
-- editor. Manual order lives in position; NULL = unsorted (legacy rows), which
-- the API lists after manually-ordered rows by creation time (newest first).
ALTER TABLE public.data_table_rows
  ADD COLUMN IF NOT EXISTS position INTEGER;

CREATE INDEX IF NOT EXISTS idx_data_table_rows_pos
  ON public.data_table_rows (table_id, position);
