-- Remove redundant duplicate indexes: each of these tables already has a
-- UNIQUE constraint covering the identical column list, so the plain index
-- just doubles write amplification on hot paths (run_steps is written once
-- per executed step; usage_counters on every metered AI call). The
-- unique-constraint indexes are kept — they serve the same reads.

DROP INDEX IF EXISTS public.idx_agent_run_events_run;        -- dup of agent_run_events_run_id_seq_key (run_id, seq)
DROP INDEX IF EXISTS public.run_steps_run_sequence_idx;      -- dup of run_steps_run_id_run_created_at_sequence_no_key
DROP INDEX IF EXISTS public.usage_counters_org_period_idx;   -- dup of usage_counters_org_id_period_start_counter_key_key
DROP INDEX IF EXISTS public.knowledge_chunks_source_idx;     -- dup of knowledge_chunks_source_id_chunk_index_key

-- flow_runs monthly partitions materialize the parent's flow_runs_id_uniq
-- constraint as per-partition indexes; the "…_idx" copies created by
-- ensureRunPartition are actually the ones BACKING the parent constraint and
-- must be kept (dropping them errors with "index … requires it"). Nothing to
-- do for partitions — this block is a no-op guard so re-runs stay safe.
SELECT 1;
