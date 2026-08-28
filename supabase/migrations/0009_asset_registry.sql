-- =============================================================================
-- Asset Registry — Unified product model
-- Every product (workflow, table, form, interface, canvas, agent, chatbot)
-- is an asset in a single tenant-aware registry.
-- =============================================================================

SET search_path TO public, extensions, pg_catalog;

-- ─── Folders ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.folders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  parent_id     UUID REFERENCES public.folders(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

-- ─── Assets ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK (type IN ('workflow', 'table', 'form', 'interface', 'canvas', 'agent', 'chatbot')),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'disabled', 'archived')),
  folder_id     UUID REFERENCES public.folders(id) ON DELETE SET NULL,
  tags          TEXT[] DEFAULT '{}',
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, type, slug)
);
CREATE INDEX IF NOT EXISTS idx_assets_org_type ON public.assets (org_id, type);
CREATE INDEX IF NOT EXISTS idx_assets_org_status ON public.assets (org_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_folder ON public.assets (folder_id) WHERE folder_id IS NOT NULL;

-- ─── Asset Relationships ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.asset_relations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_asset_id   UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  target_asset_id   UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  relation_type     TEXT NOT NULL CHECK (relation_type IN (
    'triggers', 'depends_on', 'calls', 'reads_from', 'writes_to',
    'embeds', 'contains', 'notifies', 'approves', 'uses', 'generates'
  )),
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_asset_id, target_asset_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_asset_relations_source ON public.asset_relations (source_asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_relations_target ON public.asset_relations (target_asset_id);

-- ─── Knowledge Sources ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.knowledge_sources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('file', 'url', 'table', 'document', 'text')),
  content       TEXT,
  url           TEXT,
  table_id      UUID,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_org ON public.knowledge_sources (org_id);

-- ─── Table Fields ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.table_fields (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_asset_id    UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL DEFAULT 'text',
  config            JSONB NOT NULL DEFAULT '{}',
  options           JSONB NOT NULL DEFAULT '[]',
  formula           TEXT,
  linked_table_id   UUID,
  button_action     TEXT,
  button_config     JSONB,
  ai_prompt         TEXT,
  ai_model          TEXT,
  required          BOOLEAN NOT NULL DEFAULT false,
  is_unique         BOOLEAN NOT NULL DEFAULT false,
  default_value     JSONB,
  position          INTEGER NOT NULL DEFAULT 0,
  visible           BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_table_fields_asset ON public.table_fields (table_asset_id, position);

-- ─── Table Views ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.table_views (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_asset_id          UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  org_id                  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  type                    TEXT NOT NULL DEFAULT 'grid',
  filters                 JSONB NOT NULL DEFAULT '[]',
  sorts                   JSONB NOT NULL DEFAULT '[]',
  hidden_fields           TEXT[] DEFAULT '{}',
  group_by                TEXT,
  kanban_field_id         UUID,
  calendar_date_field_id  UUID,
  created_by              UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_default              BOOLEAN NOT NULL DEFAULT false,
  is_public               BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_table_views_asset ON public.table_views (table_asset_id);

-- ─── Table Records ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.table_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  data          JSONB NOT NULL DEFAULT '{}',
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_table_records_asset ON public.table_records (table_asset_id);
CREATE INDEX IF NOT EXISTS idx_table_records_data ON public.table_records USING gin (data);

-- ─── Table Automations ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.table_automations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_asset_id  UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('on_create', 'on_update', 'on_delete', 'button_click', 'schedule')),
  trigger_config  JSONB NOT NULL DEFAULT '{}',
  workflow_id     UUID REFERENCES public.assets(id) ON DELETE SET NULL,
  agent_id        UUID REFERENCES public.assets(id) ON DELETE SET NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Notifications ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  message         TEXT,
  category        TEXT NOT NULL DEFAULT 'system',
  link_type       TEXT,
  link_id         UUID,
  source_type     TEXT,
  source_id       UUID,
  channels        TEXT[] DEFAULT '{in_app}',
  delivered       BOOLEAN NOT NULL DEFAULT false,
  read            BOOLEAN NOT NULL DEFAULT false,
  read_at         TIMESTAMPTZ,
  action_url      TEXT,
  action_label    TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_org ON public.notifications (org_id, created_at DESC);

-- ─── Notification Preferences ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  channels    TEXT[] DEFAULT '{in_app}',
  enabled     BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (user_id, category)
);

-- ─── Approval Requests ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.approval_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_type       TEXT NOT NULL,
  source_id         UUID,
  source_step_id    TEXT,
  title             TEXT NOT NULL,
  description       TEXT,
  payload           JSONB NOT NULL DEFAULT '{}',
  editable_fields   JSONB NOT NULL DEFAULT '[]',
  type              TEXT NOT NULL DEFAULT 'simple',
  assignee_id       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  assignee_role     TEXT,
  timeout_hours     INTEGER NOT NULL DEFAULT 24,
  timeout_action    TEXT NOT NULL DEFAULT 'escalate',
  stages            JSONB NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'pending',
  decision          JSONB,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_org ON public.approval_requests (org_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_assignee ON public.approval_requests (assignee_id, status) WHERE assignee_id IS NOT NULL;
