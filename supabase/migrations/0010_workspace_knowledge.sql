-- Workspace knowledge layer for Universal Copilot.
-- This is intentionally separate from the integration catalog embeddings.
-- The API must always scope retrieval by org_id before invoking vector search.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'table', 'form', 'workflow', 'run', 'agent', 'chatbot', 'document', 'url', 'manual'
  )),
  source_id TEXT,
  name TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'indexing', 'failed', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_sources_org_idx
  ON knowledge_sources(org_id, source_type, status);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  content_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_source_idx
  ON knowledge_chunks(source_id, chunk_index);

CREATE INDEX IF NOT EXISTS knowledge_chunks_org_idx
  ON knowledge_chunks(org_id);

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- Persistent, auditable agent/workspace memory. This replaces process-local
-- memory for durable preferences and learned workflow facts.
CREATE TABLE IF NOT EXISTS copilot_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  user_id UUID,
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
  ON copilot_memory(org_id, scope, scope_id);

CREATE INDEX IF NOT EXISTS copilot_memory_embedding_idx
  ON copilot_memory USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- Keep tenant ownership duplicated on chunks/memory so retrieval can enforce
-- tenant filtering without trusting source metadata.
COMMENT ON TABLE knowledge_sources IS 'Workspace-scoped sources indexed for Copilot semantic/hybrid retrieval.';
COMMENT ON TABLE knowledge_chunks IS 'Chunked workspace knowledge with pgvector embeddings.';
COMMENT ON TABLE copilot_memory IS 'Durable workspace/user Copilot memory; never store hidden chain-of-thought.';
