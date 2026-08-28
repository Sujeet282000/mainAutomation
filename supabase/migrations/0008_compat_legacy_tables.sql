-- ============================================================================
-- Compatibility layer: legacy table names → new schema
-- The API engine/scheduler/poll/mcp modules still reference old table names.
-- This migration creates updatable views + standalone tables so both old and
-- new code paths work against the same database.
-- ============================================================================

SET search_path TO public, extensions, pg_catalog;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. automations → flows  (updatable view with column aliases)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.automations AS
SELECT
  id,
  org_id                          AS workspace_id,
  name,
  slug,
  COALESCE(status::text, 'draft') AS status,
  published_version_id,
  created_at,
  updated_at                       AS deleted_at,  -- legacy code checks deleted_at is null; new schema doesn't soft-delete
  COALESCE(draft_definition, '{}') AS definition
FROM public.flows;

-- Inserter: map workspace_id back to org_id
CREATE OR REPLACE FUNCTION public._automations_ins_compat()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.flows (id, org_id, project_id, name, slug, status, draft_definition, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.workspace_id,
    COALESCE(NEW.project_id, (SELECT id FROM public.projects WHERE org_id = NEW.workspace_id LIMIT 1)),
    NEW.name,
    COALESCE(NEW.slug, lower(regexp_replace(NEW.name, '[^a-z0-9]+', '-', 'g'))),
    COALESCE(NEW.status, 'draft')::flow_status,
    COALESCE(NEW.definition, '{}')::jsonb,
    COALESCE(NEW.created_at, now()),
    now()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Updater: map workspace_id changes back to org_id
CREATE OR REPLACE FUNCTION public._automations_upd_compat()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.flows SET
    name               = NEW.name,
    slug               = COALESCE(NEW.slug, OLD.slug),
    status             = COALESCE(NEW.status, OLD.status)::flow_status,
    published_version_id = NEW.published_version_id,
    draft_definition   = COALESCE(NEW.definition, OLD.definition)::jsonb,
    updated_at         = now()
  WHERE id = OLD.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS automations_ins_compat ON public.automations;
CREATE TRIGGER automations_ins_compat
  INSTEAD OF INSERT ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public._automations_ins_compat();

DROP TRIGGER IF EXISTS automations_upd_compat ON public.automations;
CREATE TRIGGER automations_upd_compat
  INSTEAD OF UPDATE ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public._automations_upd_compat();

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. automation_versions → flow_versions  (updatable view)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.automation_versions AS
SELECT
  id,
  flow_id          AS automation_id,
  org_id           AS workspace_id,
  version_number,
  definition       AS graph,
  published_by,
  published_at,
  published_at     AS created_at
FROM public.flow_versions;

CREATE OR REPLACE FUNCTION public._automation_versions_ins_compat()
RETURNS TRIGGER AS $$
DECLARE
  v_org UUID;
BEGIN
  SELECT org_id INTO v_org FROM public.flows WHERE id = NEW.automation_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'automation_id % not found', NEW.automation_id;
  END IF;
  INSERT INTO public.flow_versions (id, org_id, flow_id, version_number, definition, definition_hash, published_by, published_at)
  VALUES (
    COALESCE(NEW.id, gen_random_uuid()),
    v_org,
    NEW.automation_id,
    COALESCE(NEW.version_number, 1),
    COALESCE(NEW.graph, '{}')::jsonb,
    encode(sha512(COALESCE(NEW.graph, '{}'::jsonb)::text::bytea), 'hex'),
    NEW.published_by,
    COALESCE(NEW.published_at, now())
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS automation_versions_ins_compat ON public.automation_versions;
CREATE TRIGGER automation_versions_ins_compat
  INSTEAD OF INSERT ON public.automation_versions
  FOR EACH ROW EXECUTE FUNCTION public._automation_versions_ins_compat();

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. executions → flow_runs  (updatable view)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.executions AS
SELECT
  id,
  flow_id                           AS automation_id,
  org_id                            AS workspace_id,
  org_id                            AS organization_id,
  flow_version_id                   AS version_id,
  COALESCE(status::text, 'queued')  AS status,
  trigger_kind                      AS trigger_type,
  trigger_event_id                  AS trigger_data,
  idempotency_key,
  context                           AS input,
  context_preview                   AS output,
  started_at                        AS started_at,
  finished_at                       AS finished_at,
  created_at,
  context                           AS error
FROM public.flow_runs;

CREATE OR REPLACE FUNCTION public._executions_ins_compat()
RETURNS TRIGGER AS $$
DECLARE
  v_org UUID;
  v_project UUID;
  v_ver UUID;
BEGIN
  v_org := NEW.workspace_id;
  SELECT id INTO v_project FROM public.projects WHERE org_id = v_org LIMIT 1;
  v_ver := NEW.version_id;
  IF v_ver IS NULL THEN
    SELECT published_version_id INTO v_ver FROM public.flows WHERE id = NEW.automation_id;
  END IF;
  IF v_ver IS NULL THEN
    SELECT id INTO v_ver FROM public.flow_versions WHERE flow_id = NEW.automation_id ORDER BY version_number DESC LIMIT 1;
  END IF;
  INSERT INTO public.flow_runs (id, org_id, project_id, flow_id, flow_version_id, trigger_kind, idempotency_key, status, context, created_at)
  VALUES (
    COALESCE(NEW.id, gen_random_uuid()),
    v_org,
    v_project,
    NEW.automation_id,
    v_ver,
    COALESCE(NEW.trigger_type, 'manual'),
    NEW.idempotency_key,
    COALESCE(NEW.status, 'queued')::run_status,
    COALESCE(NEW.input, '{}')::jsonb,
    COALESCE(NEW.created_at, now())
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS executions_ins_compat ON public.executions;
CREATE TRIGGER executions_ins_compat
  INSTEAD OF INSERT ON public.executions
  FOR EACH ROW EXECUTE FUNCTION public._executions_ins_compat();

CREATE OR REPLACE FUNCTION public._executions_upd_compat()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.flow_runs SET
    status     = COALESCE(NEW.status, OLD.status)::run_status,
    context    = COALESCE(NEW.output, NEW.input, OLD.context),
    started_at = NEW.started_at,
    finished_at = NEW.finished_at
  WHERE id = OLD.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS executions_upd_compat ON public.executions;
CREATE TRIGGER executions_upd_compat
  INSTEAD OF UPDATE ON public.executions
  FOR EACH ROW EXECUTE FUNCTION public._executions_upd_compat();

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. automation_schedules (standalone table — no equivalent in new schema)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.automation_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL,
  cron          TEXT NOT NULL DEFAULT '0 * * * *',
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  next_run_at   TIMESTAMPTZ,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_schedules_tick
  ON public.automation_schedules (enabled, next_run_at)
  WHERE enabled = true;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. polling_cursors (standalone table)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.polling_cursors (
  workspace_id  UUID NOT NULL,
  automation_id UUID NOT NULL,
  app_slug      TEXT NOT NULL,
  operation     TEXT NOT NULL,
  cursor        JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_polled_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (automation_id, app_slug, operation)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. workspace_variables (standalone table)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_variables (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  key           TEXT NOT NULL,
  value         JSONB NOT NULL DEFAULT '""'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. workspace_kv (standalone table)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_kv (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  key           TEXT NOT NULL,
  value         JSONB NOT NULL DEFAULT '""'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. digest_items (standalone table)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.digest_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  digest_key    TEXT NOT NULL,
  item          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_digest_items_lookup
  ON public.digest_items (workspace_id, digest_key, created_at);

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. approvals (standalone table for agent adapter)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL,
  execution_id    UUID NOT NULL,
  step_id         TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  deadline        TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  decided_by      UUID,
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 10. Add missing columns to flows that legacy code expects
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS webhook_public_id TEXT UNIQUE;
ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS current_version_id UUID;
ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS workspace_id UUID;  -- alias for org_id
-- Backfill workspace_id = org_id
UPDATE public.flows SET workspace_id = org_id WHERE workspace_id IS NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- 11. Add missing columns to flow_runs that legacy code expects
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.flow_runs ADD COLUMN IF NOT EXISTS error_json JSONB;
ALTER TABLE public.flow_runs ADD COLUMN IF NOT EXISTS output_json JSONB;
ALTER TABLE public.flow_runs ADD COLUMN IF NOT EXISTS input_json JSONB;
