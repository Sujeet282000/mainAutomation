-- ============================================================================
-- Orchestra Part 4 — RLS policies, triggers, and helper functions
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- Helper functions for RLS (read membership as definer, avoid recursion)
-- ──────────────────────────────────────────────────────────────────────────────

BEGIN;

-- current_actor_id: extracts user ID from JWT claims
CREATE OR REPLACE FUNCTION internal.current_actor_id()
RETURNS UUID LANGUAGE sql STABLE
SET search_path = pg_catalog, internal AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid;
$$;

-- current_org_id: extracts org ID from JWT claims
CREATE OR REPLACE FUNCTION internal.current_org_id()
RETURNS UUID LANGUAGE sql STABLE
SET search_path = pg_catalog, internal AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::jsonb->>'org_id', '')::uuid;
$$;

-- has_org_role: checks if the current user has one of the given roles in the org
CREATE OR REPLACE FUNCTION public.has_org_role(p_org_id uuid, p_roles public.org_role[])
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE user_id = internal.current_actor_id()
      AND org_id = p_org_id
      AND role = ANY(p_roles)
  );
$$;

-- is_org_member: convenience wrapper
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, public AS $$
  SELECT public.has_org_role(p_org_id, ARRAY['owner','admin','editor','viewer']::public.org_role[]);
$$;

-- is_org_editor: owner, admin, or editor
CREATE OR REPLACE FUNCTION public.is_org_editor(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, public AS $$
  SELECT public.has_org_role(p_org_id, ARRAY['owner','admin','editor']::public.org_role[]);
$$;

-- is_org_admin: owner or admin
CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, public AS $$
  SELECT public.has_org_role(p_org_id, ARRAY['owner','admin']::public.org_role[]);
$$;

-- Revoke from public, grant to authenticated
REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM public;
REVOKE ALL ON FUNCTION public.has_org_role(uuid, public.org_role[]) FROM public;
REVOKE ALL ON FUNCTION public.is_org_editor(uuid) FROM public;
REVOKE ALL ON FUNCTION public.is_org_admin(uuid) FROM public;

GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, public.org_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_editor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- Enable RLS on every tenant table
-- ──────────────────────────────────────────────────────────────────────────────

DO $rls$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'org_members', 'projects', 'pieces', 'piece_operations', 'piece_embeddings',
    'connections', 'flows', 'flow_versions', 'triggers_registry',
    'data_tables', 'data_table_rows',
    'copilot_sessions', 'copilot_events', 'copilot_actions',
    'agent_transcripts', 'ai_usage', 'audit_logs', 'usage_counters',
    'todos'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    -- Member read
    EXECUTE format(
      'CREATE POLICY member_read ON public.%I FOR SELECT TO authenticated '
      || 'USING (public.is_org_member(org_id))', t
    );
    -- Editor insert
    EXECUTE format(
      'CREATE POLICY editor_insert ON public.%I FOR INSERT TO authenticated '
      || 'WITH CHECK (public.is_org_editor(org_id))', t
    );
    -- Editor update
    EXECUTE format(
      'CREATE POLICY editor_update ON public.%I FOR UPDATE TO authenticated '
      || 'USING (public.is_org_editor(org_id)) '
      || 'WITH CHECK (public.is_org_editor(org_id))', t
    );
    -- Admin delete
    EXECUTE format(
      'CREATE POLICY admin_delete ON public.%I FOR DELETE TO authenticated '
      || 'USING (public.is_org_admin(org_id))', t
    );
  END LOOP;
END $rls$;

-- Organizations: special policies
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY member_read_organization ON public.organizations
  FOR SELECT TO authenticated USING (public.is_org_member(id));
CREATE POLICY admin_update_organization ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.is_org_admin(id))
  WITH CHECK (public.is_org_admin(id));

-- Users: own-profile only
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
CREATE POLICY read_own_profile ON public.users
  FOR SELECT TO authenticated USING (id = internal.current_actor_id());
CREATE POLICY update_own_profile ON public.users
  FOR UPDATE TO authenticated
  USING (id = internal.current_actor_id())
  WITH CHECK (id = internal.current_actor_id());

-- Public catalog visibility is additive to the tenant member-read policy
CREATE POLICY read_public_pieces ON public.pieces
  FOR SELECT TO authenticated USING (visibility = 'public');

-- Credential columns are NEVER exposed through RLS
-- (Postgres RLS controls rows, not columns — use column-level GRANT instead)

-- ──────────────────────────────────────────────────────────────────────────────
-- Triggers and functions (application-side invariants)
-- ──────────────────────────────────────────────────────────────────────────────

-- touch_updated_at: auto-update updated_at on every write
CREATE OR REPLACE FUNCTION internal.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- set_flow_version_hash: SHA-256 content addressing
CREATE OR REPLACE FUNCTION internal.set_flow_version_hash()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, extensions AS $$
BEGIN
  NEW.definition_hash := encode(digest(NEW.definition::text, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

-- prevent_flow_version_change: flow versions are immutable
CREATE OR REPLACE FUNCTION internal.prevent_flow_version_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'flow_versions are immutable' USING errcode = '55000';
END;
$$;

-- assign_run_step_sequence: monotonic sequence per run
CREATE OR REPLACE FUNCTION internal.assign_run_step_sequence()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(new.run_id::text, 0));
  SELECT coalesce(max(sequence_no), 0) + 1 INTO new.sequence_no
  FROM public.run_steps
  WHERE run_id = new.run_id AND run_created_at = new.run_created_at;
  RETURN NEW;
END;
$$;

-- write_audit_log: append-only, excludes secrets and payloads
CREATE OR REPLACE FUNCTION internal.write_audit_log()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, internal AS $$
DECLARE
  v_row jsonb;
  v_target uuid;
BEGIN
  IF tg_op = 'DELETE' THEN v_row := to_jsonb(old);
  ELSE v_row := to_jsonb(new);
  END IF;

  v_target := nullif(v_row ->> 'id', '')::uuid;

  -- Never copy encrypted material, flow payloads, or arbitrary user data into audit
  v_row := v_row - array[
    'ciphertext', 'iv', 'auth_tag', 'wrapped_dek', 'encrypted_payload',
    'draft_definition', 'definition', 'context', 'trigger_data',
    'input_json', 'output_json', 'payload_json', 'patch'
  ];

  INSERT INTO public.audit_logs (
    org_id, actor_id, actor_kind, action, target_type, target_id, metadata
  ) VALUES (
    (v_row ->> 'org_id')::uuid,
    internal.current_actor_id(),
    CASE WHEN internal.current_actor_id() IS NULL THEN 'system' ELSE 'user' END,
    lower(tg_op),
    tg_table_name,
    v_target,
    jsonb_build_object('columns', v_row)
  );

  RETURN COALESCE(new, old);
END;
$$;

-- increment_usage_counter: transactional roll-up for billing
CREATE OR REPLACE FUNCTION internal.increment_usage_counter(
  p_org_id uuid,
  p_period_start date,
  p_counter_key text,
  p_delta bigint
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, internal AS $$
BEGIN
  IF p_delta < 0 THEN
    RAISE EXCEPTION 'usage deltas must be non-negative' USING errcode = '22023';
  END IF;

  INSERT INTO public.usage_counters (
    org_id, period_start, period_end, counter_key, value
  ) VALUES (
    p_org_id, p_period_start, (p_period_start + interval '1 month')::date, p_counter_key, p_delta
  )
  ON CONFLICT (org_id, period_start, counter_key) DO UPDATE
    SET value = public.usage_counters.value + excluded.value,
        updated_at = now();
END;
$$;

-- claim_due_triggers: FOR UPDATE SKIP LOCKED polling lease
CREATE OR REPLACE FUNCTION internal.claim_due_triggers(p_limit integer)
RETURNS SETOF public.triggers_registry
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, internal AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'p_limit must be in [1, 1000]' USING errcode = '22023';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT id FROM public.triggers_registry
    WHERE enabled AND kind = 'app_event' AND next_poll_at <= now()
    ORDER BY next_poll_at, id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.triggers_registry t
  SET next_poll_at = now() + interval '5 minutes',
      updated_at = now()
  FROM due WHERE t.id = due.id
  RETURNING t.*;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- Partition management with pg_cron
-- ──────────────────────────────────────────────────────────────────────────────

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

-- ──────────────────────────────────────────────────────────────────────────────
-- Apply triggers to all relevant tables
-- ──────────────────────────────────────────────────────────────────────────────

-- updated_at triggers
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations', 'users', 'org_members', 'projects',
    'pieces', 'piece_operations', 'piece_embeddings',
    'connections', 'flows', 'triggers_registry',
    'data_tables', 'data_table_rows',
    'copilot_sessions'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION internal.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  END LOOP;
END $$;

-- flow_versions: hash + immutability
CREATE TRIGGER flow_versions_set_hash
  BEFORE INSERT ON public.flow_versions
  FOR EACH ROW EXECUTE FUNCTION internal.set_flow_version_hash();

CREATE TRIGGER flow_versions_no_update
  BEFORE UPDATE OR DELETE ON public.flow_versions
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_flow_version_change();

-- run_steps: sequence assignment
CREATE TRIGGER run_steps_assign_sequence
  BEFORE INSERT ON public.run_steps
  FOR EACH ROW EXECUTE FUNCTION internal.assign_run_step_sequence();

-- Audit triggers on high-value tables
CREATE TRIGGER flows_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.flows
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

CREATE TRIGGER connections_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.connections
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

CREATE TRIGGER todos_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.todos
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

CREATE TRIGGER copilot_sessions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.copilot_sessions
  FOR EACH ROW EXECUTE FUNCTION internal.write_audit_log();

-- ──────────────────────────────────────────────────────────────────────────────
-- AI service read-only views and restricted write capabilities
-- ──────────────────────────────────────────────────────────────────────────────

-- View: connection metadata only (no secrets) — for Copilot connection resolution
CREATE OR REPLACE VIEW internal.connection_metadata AS
SELECT
  c.id, c.org_id, c.project_id, c.piece_id, c.piece_name,
  c.label, c.auth_type, c.status, c.owner_email, c.account_email,
  c.use_count, c.last_used_at, c.expires_at, c.created_at
FROM public.connections c;

-- View: piece operations for AI retrieval
CREATE OR REPLACE VIEW internal.piece_operations_v AS
SELECT
  po.operation_id, po.kind, po.display_name, po.description,
  po.props, po.metadata, po.side_effect, po.auth_type, po.text,
  po.indexed_content_hash, po.indexed_embedding_model,
  po.indexed_embedding_text_version,
  p.name AS piece_name, p.display_name AS piece_display_name,
  p.version AS piece_version, p.categories
FROM public.piece_operations po
JOIN public.pieces p ON p.id = po.piece_id AND p.org_id = po.org_id;

-- View: organization budgets for AI
CREATE OR REPLACE VIEW internal.ai_org_budgets_v AS
SELECT
  o.id AS org_id,
  o.plan_slug,
  o.meter_mode,
  COALESCE(uc.value, 0) AS ai_credits_used
FROM public.organizations o
LEFT JOIN public.usage_counters uc
  ON uc.org_id = o.id
  AND uc.counter_key = 'ai_credits'
  AND uc.period_start = date_trunc('month', current_date)::date;

-- RPC: record AI usage (the only write the AI service may perform)
CREATE OR REPLACE FUNCTION public.record_ai_usage(
  p_org_id UUID,
  p_request_id TEXT,
  p_provider TEXT,
  p_model TEXT,
  p_purpose TEXT,
  p_tokens_in INTEGER,
  p_tokens_out INTEGER,
  p_cost_usd NUMERIC,
  p_ai_credits INTEGER DEFAULT 0,
  p_latency_ms INTEGER DEFAULT NULL,
  p_byo_key BOOLEAN DEFAULT false
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.ai_usage (
    org_id, provider, model, purpose,
    tokens_in, tokens_out, cost_usd, ai_credits,
    latency_ms, byo_key
  ) VALUES (
    p_org_id, p_provider, p_model, p_purpose,
    p_tokens_in, p_tokens_out, p_cost_usd, p_ai_credits,
    p_latency_ms, p_byo_key
  );

  -- Increment usage counters
  PERFORM internal.increment_usage_counter(
    p_org_id,
    date_trunc('month', current_date)::date,
    'ai_credits',
    p_ai_credits
  );
END;
$$;

-- RPC: upsert piece embedding for catalog reindex
CREATE OR REPLACE FUNCTION public.upsert_piece_embedding(
  p_operation_id TEXT,
  p_content_hash TEXT,
  p_embedding_model TEXT,
  p_embedding_text_version INTEGER,
  p_embedding vector(1536),
  p_search_text TEXT
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.piece_embeddings (
    org_id, operation_id, piece_id, content_hash,
    embedding_model, embedding_text_version, embedding, search_text
  )
  SELECT
    po.org_id, po.operation_id, po.piece_id, p_content_hash,
    p_embedding_model, p_embedding_text_version, p_embedding, p_search_text
  FROM public.piece_operations po
  WHERE po.operation_id = p_operation_id
  ON CONFLICT (operation_id, org_id) DO UPDATE SET
    content_hash = p_content_hash,
    embedding_model = p_embedding_model,
    embedding_text_version = p_embedding_text_version,
    embedding = p_embedding,
    search_text = p_search_text,
    updated_at = now();
END;
$$;

-- RPC: hybrid vector + text catalog search with Reciprocal Rank Fusion
CREATE OR REPLACE FUNCTION public.match_operations_hybrid(
  query_embedding vector(1536),
  query_text TEXT,
  match_count INTEGER DEFAULT 40,
  rrf_k INTEGER DEFAULT 60
)
RETURNS TABLE (
  operation_id TEXT,
  canonical_id TEXT,
  display_name TEXT,
  description TEXT,
  score NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN QUERY
  WITH vector_rank AS (
    SELECT
      pe.operation_id,
      ROW_NUMBER() OVER (ORDER BY pe.embedding <=> query_embedding) AS rank
    FROM public.piece_embeddings pe
    ORDER BY pe.embedding <=> query_embedding
    LIMIT match_count
  ),
  text_rank AS (
    SELECT
      po.operation_id,
      ROW_NUMBER() OVER (ORDER BY ts_rank_cd(po.text::tsvector, plainto_tsquery('simple', query_text)) DESC) AS rank
    FROM public.piece_operations po
    WHERE plainto_tsquery('simple', query_text) @@ po.text::tsvector
    LIMIT match_count
  ),
  combined AS (
    SELECT
      COALESCE(v.operation_id, t.operation_id) AS operation_id,
      COALESCE(v.rank, match_count + 1) AS v_rank,
      COALESCE(t.rank, match_count + 1) AS t_rank
    FROM vector_rank v
    FULL OUTER JOIN text_rank t ON v.operation_id = t.operation_id
  )
  SELECT
    c.operation_id,
    c.operation_id AS canonical_id,
    po.display_name,
    po.description,
    (1.0 / (rrf_k + c.v_rank) + 1.0 / (rrf_k + c.t_rank))::NUMERIC AS score
  FROM combined c
  JOIN public.piece_operations po ON po.operation_id = c.operation_id
  ORDER BY score DESC
  LIMIT match_count;
END;
$$;

-- RPC: touch_connection (update use count and last_used_at)
CREATE OR REPLACE FUNCTION public.touch_connection(
  p_org_id UUID,
  p_connection_id UUID
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.connections
  SET use_count = use_count + 1,
      last_used_at = now(),
      updated_at = now()
  WHERE id = p_connection_id AND org_id = p_org_id;
END;
$$;

-- RPC: flows_using_connection (find dependent flows)
CREATE OR REPLACE FUNCTION public.flows_using_connection(
  p_org_id UUID,
  p_connection_id UUID
)
RETURNS TABLE (flow_id UUID) LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT DISTINCT f.id
  FROM public.flows f
  WHERE f.org_id = p_org_id
    AND f.draft_definition::text LIKE '%' || p_connection_id::text || '%'
$$;

-- RPC: flow_dependencies
CREATE OR REPLACE FUNCTION public.flow_dependencies(
  p_org_id UUID,
  p_flow_id UUID
)
RETURNS TABLE (dependency_type TEXT, dependency_id TEXT)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT 'connection'::TEXT, conn_id
  FROM jsonb_array_elements_text(
    (SELECT regexp_matches(draft_definition::text, '"connectionId"\s*:\s*"([^"]+)"', 'g')
     FROM public.flows WHERE id = p_flow_id AND org_id = p_org_id)
  ) AS conn_id
  WHERE conn_id IS NOT NULL
$$;

COMMIT;
