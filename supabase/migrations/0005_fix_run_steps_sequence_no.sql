-- Fix: run_steps missing sequence_no column
-- The API inserts sequence_no but the column was never created in the schema.
-- Also create the partition helper function needed by ensureRunPartition().

ALTER TABLE public.run_steps
  ADD COLUMN IF NOT EXISTS sequence_no integer NOT NULL DEFAULT 0;

-- Partition helper used by ensureRunPartition() in apps/api/src/flow-runtime.ts
CREATE OR REPLACE FUNCTION internal.create_flow_run_partitions(p_months_ahead integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, internal AS $$
DECLARE
  v_start timestamptz;
  v_end   timestamptz;
  v_name  text;
  i       integer;
BEGIN
  IF p_months_ahead < 0 OR p_months_ahead > 24 THEN
    RAISE EXCEPTION 'months must be in [0, 24]' USING errcode = '22023';
  END IF;
  FOR i IN 0..p_months_ahead LOOP
    v_start := date_trunc('month', now()) + make_interval(months => i);
    v_end   := v_start + interval '1 month';
    v_name  := format('flow_runs_%s', to_char(v_start, 'YYYY_MM'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.flow_runs '
      || 'FOR VALUES FROM (%L) TO (%L)',
      v_name, v_start, v_end
    );
  END LOOP;
END;
$$;
