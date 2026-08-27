-- ============================================================================
-- Orchestra — Complete Data Model on Supabase (Part 4)
-- Baseline migration: extensions, schemas, tables, RLS, triggers, functions
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- Extensions
-- ──────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;          -- pgvector, schema: extensions

-- pg_cron requires Supabase project setting; fail early if absent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'pg_cron extension not available — scheduling features degraded';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- Schemas
-- ──────────────────────────────────────────────────────────────────────────────

-- internal: privileged helpers, partition maintenance, service-only decryption.
-- Its schema privilege is granted solely to service_role.
CREATE SCHEMA IF NOT EXISTS internal;

-- ──────────────────────────────────────────────────────────────────────────────
-- Enum types
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_role') THEN
    CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'editor', 'viewer');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'flow_status') THEN
    CREATE TYPE public.flow_status AS ENUM ('draft', 'active', 'paused', 'disabled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'run_status') THEN
    CREATE TYPE public.run_status AS ENUM (
      'queued', 'running', 'succeeded', 'failed',
      'paused', 'cancelled', 'filtered', 'dehydrated'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'step_status') THEN
    CREATE TYPE public.step_status AS ENUM (
      'queued', 'running', 'succeeded', 'failed', 'skipped'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'error_class') THEN
    CREATE TYPE public.error_class AS ENUM (
      'auth', 'validation', 'transient', 'fatal', 'budget'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'todo_status') THEN
    CREATE TYPE public.todo_status AS ENUM (
      'pending', 'approved', 'rejected', 'expired'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connection_status') THEN
    CREATE TYPE public.connection_status AS ENUM (
      'active', 'expired', 'error', 'missing'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'piece_visibility') THEN
    CREATE TYPE public.piece_visibility AS ENUM ('public', 'private');
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- Identity, membership, and projects
-- ──────────────────────────────────────────────────────────────────────────────

-- users: global profile keyed one-to-one to auth.users
CREATE TABLE public.users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  email_normalized TEXT GENERATED ALWAYS AS (lower(trim(email))) STORED,
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- organizations: the tenant isolation boundary
CREATE TABLE public.organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  plan_slug   TEXT NOT NULL DEFAULT 'free',
  meter_mode  TEXT NOT NULL DEFAULT 'dual', -- run | step | dual
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- org_members: tenant membership and roles
CREATE TABLE public.org_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role          public.org_role NOT NULL DEFAULT 'editor',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

-- projects: workspace-like container within an organization
CREATE TABLE public.projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug),
  UNIQUE (id, org_id)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- Piece catalog and retrieval embeddings
-- ──────────────────────────────────────────────────────────────────────────────

-- pieces: owned by catalog org (public) or organization (private)
CREATE TABLE public.pieces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  version         TEXT NOT NULL,
  description     TEXT,
  categories      TEXT[] NOT NULL DEFAULT '{}',
  visibility      public.piece_visibility NOT NULL DEFAULT 'private',
  deprecated_at   TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name, version),
  UNIQUE (id, org_id)
);

-- piece_operations: one trigger or action per row, identified as piece:kind:name
CREATE TABLE public.piece_operations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL,
  piece_id        UUID NOT NULL,
  operation_id    TEXT NOT NULL,  -- canonical_id: piece_name:kind:name
  kind            TEXT NOT NULL CHECK (kind IN ('trigger', 'action', 'search')),
  display_name    TEXT NOT NULL,
  description     TEXT,
  props           JSONB NOT NULL DEFAULT '[]',
  metadata        JSONB NOT NULL DEFAULT '{}',
  side_effect     TEXT NOT NULL DEFAULT 'read' CHECK (side_effect IN ('read', 'create', 'update', 'delete')),
  auth_type       TEXT NOT NULL DEFAULT 'none',
  text            TEXT NOT NULL DEFAULT '',
  indexed_content_hash   TEXT,
  indexed_embedding_model TEXT,
  indexed_embedding_text_version INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (piece_id, org_id) REFERENCES public.pieces(id, org_id) ON DELETE RESTRICT,
  UNIQUE (operation_id, org_id),
  UNIQUE (id, org_id)
);

-- piece_embeddings: 1536-dimension pgvector for hybrid retrieval
CREATE TABLE public.piece_embeddings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  operation_id      TEXT NOT NULL,
  piece_id          UUID NOT NULL,
  content_hash      TEXT NOT NULL,
  embedding_model   TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  embedding_text_version INTEGER NOT NULL DEFAULT 1,
  embedding         vector(1536),
  search_text       TEXT NOT NULL DEFAULT '',
  content_tsv       tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(search_text, ''))
  ) STORED,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (operation_id, org_id) REFERENCES public.piece_operations(operation_id, org_id) ON DELETE CASCADE,
  UNIQUE (operation_id, org_id)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- Connections, flow drafts, versions, and trigger activation
-- ──────────────────────────────────────────────────────────────────────────────

-- connections: encrypted credential instances, org-scoped
CREATE TABLE public.connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id        UUID,
  piece_id          UUID,
  piece_name        TEXT NOT NULL,
  label             TEXT NOT NULL,
  auth_type         TEXT NOT NULL CHECK (auth_type IN ('oauth2', 'api_key', 'basic', 'custom', 'none')),
  status            public.connection_status NOT NULL DEFAULT 'active',
  error_code        TEXT,
  owner_email       TEXT,
  account_email     TEXT,
  use_count         INTEGER NOT NULL DEFAULT 0,
  last_used_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,

  -- Envelope encryption: AES-256-GCM ciphertext columns
  -- Postgres RLS controls rows, not columns. The explicit column grant
  -- means a client query cannot name ciphertext, iv, auth_tag, or wrapped_dek.
  ciphertext        BYTEA,
  iv                BYTEA,
  auth_tag          BYTEA,
  wrapped_dek       BYTEA,
  encrypted_payload JSONB,  -- alternative: full encrypted JSON blob

  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (project_id, org_id) REFERENCES public.projects(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (piece_id, org_id)   REFERENCES public.pieces(id, org_id) ON DELETE RESTRICT,
  UNIQUE (id, org_id)
);

-- flows: mutable draft definition
CREATE TABLE public.flows (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL,
  description         TEXT,
  status              public.flow_status NOT NULL DEFAULT 'draft',
  draft_definition    JSONB NOT NULL DEFAULT '{}',
  draft_schema_version INTEGER GENERATED ALWAYS AS (
    nullif(draft_definition ->> 'schemaVersion', '')::integer
  ) STORED,
  published_version_id UUID,
  origin              TEXT NOT NULL DEFAULT 'manual', -- manual | copilot | template | api | import
  created_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (project_id, org_id) REFERENCES public.projects(id, org_id) ON DELETE CASCADE,
  CHECK (origin IN ('manual', 'copilot', 'template', 'api', 'import')),
  CHECK (jsonb_typeof(draft_definition) = 'object'),
  CHECK (draft_schema_version IS NOT NULL AND draft_schema_version >= 1),
  UNIQUE (org_id, project_id, slug),
  UNIQUE (id, org_id)
);

-- flow_versions: immutable, content-addressed snapshots
CREATE TABLE public.flow_versions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL,
  flow_id                 UUID NOT NULL,
  version_number          INTEGER NOT NULL,
  definition              JSONB NOT NULL,
  definition_schema_version INTEGER GENERATED ALWAYS AS (
    nullif(definition ->> 'schemaVersion', '')::integer
  ) STORED,
  definition_hash         TEXT NOT NULL,
  published_by            UUID REFERENCES public.users(id) ON DELETE SET NULL,
  published_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (flow_id, org_id) REFERENCES public.flows(id, org_id) ON DELETE CASCADE,
  CHECK (version_number > 0),
  CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(definition) = 'object'),
  CHECK (definition_schema_version IS NOT NULL AND definition_schema_version >= 1),
  UNIQUE (flow_id, version_number),
  UNIQUE (flow_id, definition_hash),
  UNIQUE (id, org_id)
);

-- published_version FK on flows
ALTER TABLE public.flows
  ADD CONSTRAINT flows_published_version_fk
  FOREIGN KEY (published_version_id, org_id)
  REFERENCES public.flow_versions(id, org_id) ON DELETE SET NULL;

-- triggers_registry: activation state for scheduled, webhook, and polling triggers
CREATE TABLE public.triggers_registry (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL,
  flow_id             UUID NOT NULL,
  flow_version_id     UUID NOT NULL,
  kind                TEXT NOT NULL, -- app_event | schedule | webhook | form | manual
  operation_id        UUID,
  connection_id       UUID,
  piece_name          TEXT,
  webhook_token       TEXT UNIQUE,
  webhook_secret_hash BYTEA,
  external_hook_id    TEXT,
  cron_expr           TEXT,
  timezone            TEXT NOT NULL DEFAULT 'UTC',
  poll_cursor         JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_poll_at        TIMESTAMPTZ,
  enabled             BOOLEAN NOT NULL DEFAULT true,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  status              TEXT NOT NULL DEFAULT 'active',
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (flow_id, org_id) REFERENCES public.flows(id, org_id) ON DELETE CASCADE,
  UNIQUE (id, org_id)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- Partitioned execution and human work
-- ──────────────────────────────────────────────────────────────────────────────

-- flow_runs: partitioned by created_at month
CREATE TABLE public.flow_runs (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL,
  flow_id           UUID NOT NULL,
  flow_version_id   UUID NOT NULL,
  trigger_kind      TEXT NOT NULL, -- webhook | schedule | manual | test | agent_call
  trigger_event_id  TEXT,
  idempotency_key   TEXT,
  status            public.run_status NOT NULL DEFAULT 'queued',
  context           JSONB NOT NULL DEFAULT '{}',
  context_preview   JSONB NOT NULL DEFAULT '{}',
  transition_epoch  INTEGER NOT NULL DEFAULT 0,
  transition_lease  TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  duration_ms       INTEGER GENERATED ALWAYS AS (
    CASE WHEN finished_at IS NULL OR started_at IS NULL THEN NULL
    ELSE (extract(epoch from (finished_at - started_at)) * 1000)::integer
    END
  ) STORED,
  steps_billable    INTEGER NOT NULL DEFAULT 0 CHECK (steps_billable >= 0),
  paused_reason     TEXT,
  resume_at         TIMESTAMPTZ,

  PRIMARY KEY (id, created_at),
  FOREIGN KEY (flow_id, org_id) REFERENCES public.flows(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (flow_version_id, org_id) REFERENCES public.flow_versions(id, org_id) ON DELETE RESTRICT
) PARTITION BY RANGE (created_at);
CREATE UNIQUE INDEX flow_runs_idempotency_idx ON public.flow_runs (org_id, idempotency_key, created_at) WHERE idempotency_key IS NOT NULL;

-- run_steps: one row per node execution, partition key = run_created_at
CREATE TABLE public.run_steps (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL,
  run_created_at    TIMESTAMPTZ NOT NULL,
  org_id            UUID NOT NULL,
  step_id           TEXT NOT NULL,
  step_type         TEXT NOT NULL,
  operation_id      UUID,
  sequence_no       INTEGER NOT NULL DEFAULT 0,
  attempt           INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  effect_key        TEXT,  -- stable idempotency key for side-effecting steps
  status            public.step_status NOT NULL DEFAULT 'queued',
  input_json        JSONB,
  input_ref         TEXT,  -- Private Storage path for oversized payload
  output_json       JSONB,
  output_ref        TEXT,  -- Private Storage path for oversized payload
  output_preview    JSONB,  -- redacted, capped at 4KB for run inspector
  error_class       public.error_class,
  error_code        TEXT,
  error_json        JSONB,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  duration_ms       INTEGER GENERATED ALWAYS AS (
    CASE WHEN finished_at IS NULL OR started_at IS NULL THEN NULL
    ELSE (extract(epoch from (finished_at - started_at)) * 1000)::integer
    END
  ) STORED,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (id, run_created_at),
  FOREIGN KEY (run_id, run_created_at, org_id)
    REFERENCES public.flow_runs(id, created_at, org_id) ON DELETE CASCADE,
  FOREIGN KEY (operation_id, org_id)
    REFERENCES public.piece_operations(id, org_id) ON DELETE RESTRICT,
  CHECK (step_type IN (
    'piece_action', 'http', 'code', 'ai', 'agent', 'filter', 'branch', 'router',
    'loop', 'delay', 'approval', 'data_table', 'note', 'sub_flow'
  )),
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),
  UNIQUE (run_id, run_created_at, sequence_no),
  UNIQUE (run_id, step_id, attempt)
);

-- todos: pending human decisions or tasks
CREATE TABLE public.todos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id            UUID NOT NULL,
  run_created_at    TIMESTAMPTZ NOT NULL,
  step_id           TEXT NOT NULL,
  assignee_id       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  assignee_role     public.org_role,
  title             TEXT NOT NULL,
  payload_json      JSONB NOT NULL DEFAULT '{}'::jsonb
                      CHECK (jsonb_typeof(payload_json) = 'object'),
  editable_fields   JSONB NOT NULL DEFAULT '[]'::jsonb
                      CHECK (jsonb_typeof(editable_fields) = 'array'),
  status            public.todo_status NOT NULL DEFAULT 'pending',
  resolution        JSONB,
  expires_at        TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (run_id, run_created_at, org_id)
    REFERENCES public.flow_runs(id, created_at, org_id) ON DELETE CASCADE,
  CHECK (resolved_at IS NULL OR status IN ('approved', 'rejected', 'expired')),
  UNIQUE (id, org_id)
);

COMMENT ON COLUMN public.run_steps.output_ref
  IS 'Private run-payloads path. The API issues a short-lived signed URL after authorization.';
COMMENT ON COLUMN public.todos.payload_json
  IS 'Masked review payload. A Todo blocks a dehydrated run until resolution or expiry.';

-- ──────────────────────────────────────────────────────────────────────────────
-- Data tables, Copilot, agent history, billing, and audit
-- ──────────────────────────────────────────────────────────────────────────────

-- data_tables: user-defined tables within a project
CREATE TABLE public.data_tables (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  schema_json JSONB NOT NULL DEFAULT '{"fields":[]}'
                CHECK (jsonb_typeof(schema_json) = 'object'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (project_id, org_id) REFERENCES public.projects(id, org_id) ON DELETE CASCADE,
  UNIQUE (project_id, slug),
  UNIQUE (id, org_id)
);

-- data_table_rows
CREATE TABLE public.data_table_rows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL,
  table_id      UUID NOT NULL,
  data          JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(data) = 'object'),
  search_tsv    tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(data::text, ''))
  ) STORED,
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (table_id, org_id) REFERENCES public.data_tables(id, org_id) ON DELETE CASCADE,
  UNIQUE (id, org_id)
);

-- copilot_sessions: authoring sessions
CREATE TABLE public.copilot_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  flow_id     UUID,
  mode        TEXT NOT NULL DEFAULT 'auto_build',
  stage       TEXT NOT NULL DEFAULT 'intent',
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (project_id, org_id) REFERENCES public.projects(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (flow_id, org_id)   REFERENCES public.flows(id, org_id) ON DELETE SET NULL,
  CHECK (mode IN ('auto_build', 'ask_as_you_build')),
  CHECK (stage IN (
    'intent', 'retrieve', 'select', 'connections', 'schemas',
    'mapping', 'assemble', 'validate', 'repair', 'persist'
  )),
  CHECK (status IN ('active', 'completed', 'failed', 'cancelled')),
  UNIQUE (id, org_id)
);

-- copilot_events: SSE event log per session
CREATE TABLE public.copilot_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL,
  session_id    UUID NOT NULL,
  sequence_no   INTEGER NOT NULL,
  event_type    TEXT NOT NULL,
  stage         TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (session_id, org_id)
    REFERENCES public.copilot_sessions(id, org_id) ON DELETE CASCADE,
  CHECK (event_type IN (
    'stage', 'reasoning', 'proposal', 'applied', 'todo', 'usage', 'done', 'error'
  )),
  CHECK (stage IS NULL OR stage IN (
    'intent', 'retrieve', 'select', 'connections', 'schemas',
    'mapping', 'assemble', 'validate', 'repair', 'persist'
  )),
  CHECK (jsonb_typeof(payload) = 'object'),
  UNIQUE (session_id, sequence_no),
  UNIQUE (id, org_id)
);

-- copilot_actions: RFC-6902 JSON Patch applied to mutable draft only
CREATE TABLE public.copilot_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL,
  session_id    UUID NOT NULL,
  flow_id       UUID,
  kind          TEXT NOT NULL, -- plan | add_step | set_field | add_logic | repair | explain
  patch         JSONB NOT NULL DEFAULT '[]'::jsonb,
  reasoning     TEXT,
  confidence    NUMERIC(4, 3),
  accepted      BOOLEAN, -- Null while awaiting decision
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (session_id, org_id)
    REFERENCES public.copilot_sessions(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (flow_id, org_id)
    REFERENCES public.flows(id, org_id) ON DELETE CASCADE,
  CHECK (kind IN ('plan', 'add_step', 'set_field', 'add_logic', 'repair', 'explain')),
  CHECK (jsonb_typeof(patch) = 'array'),
  CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  UNIQUE (id, org_id)
);

-- agent_transcripts: visible reasoning trace per agent step
CREATE TABLE public.agent_transcripts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id          UUID NOT NULL,
  run_created_at  TIMESTAMPTZ NOT NULL,
  step_id         TEXT NOT NULL,
  iteration       INTEGER NOT NULL CHECK (iteration > 0),
  event_kind      TEXT NOT NULL, -- reasoning | tool_call | tool_result | final
  content         TEXT,
  tool_name       TEXT,
  tool_args       JSONB,
  tool_result     JSONB,
  tokens_in       INTEGER CHECK (tokens_in IS NULL OR tokens_in >= 0),
  tokens_out      INTEGER CHECK (tokens_out IS NULL OR tokens_out >= 0),
  cost_usd        NUMERIC(14, 6) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (run_id, run_created_at, org_id)
    REFERENCES public.flow_runs(id, created_at, org_id) ON DELETE CASCADE,
  CHECK (event_kind IN ('reasoning', 'tool_call', 'tool_result', 'final')),
  UNIQUE (run_id, run_created_at, step_id, iteration, event_kind)
);

-- ai_usage: immutable billing rows for model provider calls
CREATE TABLE public.ai_usage (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id              UUID,
  run_created_at      TIMESTAMPTZ,
  copilot_session_id  UUID,
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  purpose             TEXT NOT NULL, -- copilot | ai_step | agent | ops | embedding
  tokens_in           INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out          INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost_usd            NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  ai_credits          INTEGER NOT NULL DEFAULT 0 CHECK (ai_credits >= 0),
  byo_key             BOOLEAN NOT NULL DEFAULT false,
  latency_ms          INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (run_id, run_created_at, org_id)
    REFERENCES public.flow_runs(id, created_at, org_id) ON DELETE SET NULL,
  FOREIGN KEY (copilot_session_id, org_id)
    REFERENCES public.copilot_sessions(id, org_id) ON DELETE SET NULL,
  CHECK (purpose IN ('copilot', 'ai_step', 'agent', 'ops', 'embedding')),
  CHECK (run_id IS NOT NULL OR copilot_session_id IS NOT NULL OR purpose = 'embedding')
);

-- audit_logs: immutable append-only audit trail
CREATE TABLE public.audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  actor_kind  TEXT NOT NULL DEFAULT 'user',
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   UUID,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (actor_kind IN ('user', 'copilot', 'agent', 'system')),
  CHECK (jsonb_typeof(metadata) = 'object')
);

-- usage_counters: transactional roll-up for quotas and dashboards
CREATE TABLE public.usage_counters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  counter_key   TEXT NOT NULL, -- runs | steps | ai_credits | storage_bytes
  value         BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (period_end > period_start),
  CHECK (counter_key IN ('runs', 'steps', 'ai_credits', 'storage_bytes')),
  UNIQUE (org_id, period_start, counter_key)
);

-- ──────────────────────────────────────────────────────────────────────────────
-- Commit tables before indexes
-- ──────────────────────────────────────────────────────────────────────────────
COMMIT;

-- ──────────────────────────────────────────────────────────────────────────────
-- Indexes (separate for concurrent production rollouts)
-- ──────────────────────────────────────────────────────────────────────────────

-- Membership lookup behind all tenant RLS checks
CREATE INDEX org_members_user_org_idx ON public.org_members (user_id, org_id);
CREATE INDEX org_members_org_role_idx ON public.org_members (org_id, role);

-- Project and catalog browser
CREATE INDEX projects_org_created_idx ON public.projects (org_id, created_at DESC);
CREATE INDEX pieces_lookup_idx ON public.pieces (org_id, name, version DESC);
CREATE INDEX pieces_public_lookup_idx ON public.pieces (name, version DESC)
  WHERE visibility = 'public' AND deprecated_at IS NULL;
CREATE INDEX piece_operations_piece_kind_idx
  ON public.piece_operations (piece_id, kind, display_name);

-- pgvector HNSW for approximate cosine nearest-neighbor
CREATE INDEX piece_embeddings_hnsw_idx
  ON public.piece_embeddings USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
-- GIN for lexical recall
CREATE INDEX piece_embeddings_tsv_idx
  ON public.piece_embeddings USING gin (content_tsv);

-- Connection selector: active, most-used choices and expiry scanning
CREATE INDEX connections_active_piece_idx
  ON public.connections (org_id, project_id, piece_id, last_used_at DESC)
  WHERE status = 'active';
CREATE INDEX connections_expiring_idx
  ON public.connections (org_id, expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;

-- Builder list, published trigger resolution, and scheduler polling
CREATE INDEX flows_project_updated_idx
  ON public.flows (org_id, project_id, updated_at DESC);
CREATE UNIQUE INDEX flow_versions_published_idx
  ON public.flow_versions (flow_id, version_number DESC);
CREATE INDEX triggers_due_poll_idx
  ON public.triggers_registry (next_poll_at, id)
  WHERE enabled AND kind = 'app_event' AND next_poll_at IS NOT NULL;
CREATE INDEX triggers_flow_enabled_idx
  ON public.triggers_registry (org_id, flow_id) WHERE enabled;

-- Run inspection, flow metrics, queue reconciliation
CREATE INDEX flow_runs_flow_created_idx
  ON public.flow_runs (org_id, flow_id, created_at DESC);
CREATE INDEX flow_runs_status_created_idx
  ON public.flow_runs (org_id, status, created_at DESC)
  WHERE status IN ('queued', 'running', 'paused');

-- Per-run step streaming
CREATE INDEX run_steps_run_sequence_idx
  ON public.run_steps (run_id, run_created_at, sequence_no);
CREATE INDEX run_steps_piece_duration_idx
  ON public.run_steps (operation_id, duration_ms)
  WHERE status = 'succeeded' AND operation_id IS NOT NULL;

-- Todo inbox
CREATE INDEX todos_pending_oldest_idx
  ON public.todos (org_id, created_at DESC) WHERE status = 'pending';

-- Data table rows
CREATE INDEX data_rows_table_updated_idx
  ON public.data_table_rows (table_id, updated_at DESC);

-- Copilot
CREATE INDEX copilot_sessions_user_updated_idx
  ON public.copilot_sessions (org_id, user_id, updated_at DESC);
CREATE INDEX copilot_actions_flow_created_idx
  ON public.copilot_actions (flow_id, created_at DESC);

-- AI spend
CREATE INDEX ai_usage_org_purpose_created_idx
  ON public.ai_usage (org_id, purpose, created_at DESC);

-- Usage counters
CREATE INDEX usage_counters_org_period_idx
  ON public.usage_counters (org_id, period_start, counter_key);

-- Audit logs
CREATE INDEX audit_logs_org_created_idx
  ON public.audit_logs (org_id, created_at DESC);

-- Run partition management (for pg_cron archival)
CREATE TABLE IF NOT EXISTS internal.run_partition_archives (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partition_name  TEXT NOT NULL UNIQUE,
  range_start     TIMESTAMPTZ NOT NULL,
  range_end       TIMESTAMPTZ NOT NULL,
  state           TEXT NOT NULL DEFAULT 'pending',
  archive_object_path TEXT,
  archive_sha256  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
