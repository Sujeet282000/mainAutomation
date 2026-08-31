-- Workspace knowledge layer for Universal Copilot.
-- Reuses the knowledge_sources table created by 0009_asset_registry.sql.
-- Do not create a second knowledge_sources table: the asset registry already
-- owns that resource. This migration extends it with indexing metadata.

SET search_path TO public, extensions, pg_catalog;

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.knowledge_sources
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Preserve existing data when upgrading from the asset-registry schema.
UPDATE public.knowledge_sources
SET source_type = CASE
  WHEN type = 'table' THEN 'table'
  WHEN type = 'url' THEN 'url'
  WHEN type IN ('file', 'document') THEN 'document'
  ELSE 'manual'
END
WHERE source_type IS NULL;

ALTER TABLE public.knowledge_sources
  ALTER COLUMN source_type SET NOT NULL;

ALTER TABLE public.knowledge_sources
  DROP CONSTRAINT IF EXISTS knowledge_sources_status_check;
ALTER TABLE public.knowledge_sources
  ADD CONSTRAINT knowledge_sources_status_check
  CHECK (status IN ('active', 'indexing', 'failed', 'deleted'));

CREATE INDEX IF NOT EXISTS knowledge_sources_scope_idx
  ON public.knowledge_sources(org_id, source_type, status);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_sources_org_type_source_idx
  ON public.knowledge_sources(org_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

-- Chunked semantic knowledge. Tenant ownership is duplicated deliberately so
-- every retrieval query can enforce org isolation at the chunk level.
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES public.knowledge_sources(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  content_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_source_idx
  ON public.knowledge_chunks(source_id, chunk_index);

CREATE INDEX IF NOT EXISTS knowledge_chunks_org_idx
  ON public.knowledge_chunks(org_id);

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON public.knowledge_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- Persistent, auditable Copilot memory. This is separate from retrieval
-- sources and must never contain hidden model chain-of-thought.
CREATE TABLE IF NOT EXISTS public.copilot_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  scope TEXT NOT NULL CHECK (scope IN ('workspace', 'user', 'workflow', 'session')),
  scope_id TEXT,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('preference', 'fact', 'correction', 'mapping', 'workflow_pattern')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS copilot_memory_scope_idx
  ON public.copilot_memory(org_id, scope, scope_id);

CREATE INDEX IF NOT EXISTS copilot_memory_embedding_idx
  ON public.copilot_memory USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

COMMENT ON TABLE public.knowledge_sources IS 'Workspace-scoped sources indexed for Copilot semantic/hybrid retrieval.';
COMMENT ON TABLE public.knowledge_chunks IS 'Chunked workspace knowledge with pgvector embeddings.';
COMMENT ON TABLE public.copilot_memory IS 'Durable workspace/user Copilot memory; never store hidden chain-of-thought.';
