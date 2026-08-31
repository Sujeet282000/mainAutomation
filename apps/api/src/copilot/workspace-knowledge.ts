import { query, queryOne } from "../db";

export type KnowledgeSourceType =
  | "table" | "form" | "workflow" | "run" | "agent" | "chatbot" | "document" | "url" | "manual";

export type KnowledgeChunk = {
  sourceId: string;
  orgId: string;
  chunkIndex: number;
  content: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
  contentHash?: string;
};

function vectorLiteral(values: number[]): string {
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Embedding must contain finite numeric values");
  }
  return `[${values.join(",")}]`;
}

/** Create or update a workspace-scoped knowledge source. */
export async function upsertKnowledgeSource(input: {
  orgId: string;
  sourceType: KnowledgeSourceType;
  sourceId?: string;
  name: string;
  metadata?: Record<string, unknown>;
  contentHash?: string;
}): Promise<{ id: string }> {
  const existing = input.sourceId
    ? await queryOne<{ id: string }>(
        `SELECT id FROM knowledge_sources
         WHERE org_id = $1 AND source_type = $2 AND source_id = $3
         LIMIT 1`,
        [input.orgId, input.sourceType, input.sourceId],
      )
    : null;

  if (existing) {
    await query(
      `UPDATE knowledge_sources
       SET name = $2, metadata = $3::jsonb, content_hash = $4,
           status = 'active', updated_at = NOW()
       WHERE id = $1 AND org_id = $5`,
      [existing.id, input.name, JSON.stringify(input.metadata ?? {}), input.contentHash ?? null, input.orgId],
    );
    return { id: existing.id };
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO knowledge_sources
      (org_id, source_type, source_id, name, metadata, content_hash)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id`,
    [
      input.orgId,
      input.sourceType,
      input.sourceId ?? null,
      input.name,
      JSON.stringify(input.metadata ?? {}),
      input.contentHash ?? null,
    ],
  );
  if (!row) throw new Error("Failed to create knowledge source");
  return { id: row.id };
}

/** Replace all chunks for a source. Used by deterministic re-index jobs. */
export async function replaceKnowledgeChunks(orgId: string, sourceId: string, chunks: KnowledgeChunk[]): Promise<void> {
  const source = await queryOne<{ id: string }>(
    `SELECT id FROM knowledge_sources WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [sourceId, orgId],
  );
  if (!source) throw new Error("Knowledge source not found in this workspace");

  await query(`DELETE FROM knowledge_chunks WHERE source_id = $1 AND org_id = $2`, [sourceId, orgId]);

  for (const chunk of chunks) {
    if (chunk.orgId !== orgId || chunk.sourceId !== sourceId) {
      throw new Error("Knowledge chunk tenant/source mismatch");
    }
    await query(
      `INSERT INTO knowledge_chunks
        (source_id, org_id, chunk_index, content, metadata, embedding, content_hash)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector, $7)`,
      [
        sourceId,
        orgId,
        chunk.chunkIndex,
        chunk.content,
        JSON.stringify(chunk.metadata ?? {}),
        chunk.embedding?.length ? vectorLiteral(chunk.embedding) : null,
        chunk.contentHash ?? null,
      ],
    );
  }
}

/**
 * Workspace-only semantic retrieval. The org_id predicate is mandatory and
 * intentionally duplicated on knowledge_chunks to prevent cross-tenant joins.
 */
export async function searchWorkspaceKnowledge(input: {
  orgId: string;
  queryText?: string;
  embedding?: number[];
  limit?: number;
  sourceTypes?: KnowledgeSourceType[];
}): Promise<Array<{
  chunkId: string;
  sourceId: string;
  sourceType: KnowledgeSourceType;
  sourceName: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}>> {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 50);
  const hasVector = Boolean(input.embedding?.length);
  const hasText = Boolean(input.queryText?.trim());
  if (!hasVector && !hasText) return [];

  const params: unknown[] = [input.orgId];
  let typeClause = "";
  if (input.sourceTypes?.length) {
    params.push(input.sourceTypes);
    typeClause = ` AND ks.source_type = ANY($${params.length})`;
  }

  if (hasVector) {
    params.push(vectorLiteral(input.embedding!));
    const vectorParam = params.length;
    params.push(limit);
    const limitParam = params.length;
    const rows = await query(
      `SELECT kc.id AS "chunkId", kc.source_id AS "sourceId",
              ks.source_type AS "sourceType", ks.name AS "sourceName",
              kc.content, kc.metadata,
              1 - (kc.embedding <=> $${vectorParam}::vector) AS score
       FROM knowledge_chunks kc
       JOIN knowledge_sources ks ON ks.id = kc.source_id
       WHERE kc.org_id = $1 AND ks.org_id = $1
         AND ks.status = 'active'
         AND kc.embedding IS NOT NULL
         ${typeClause}
       ORDER BY kc.embedding <=> $${vectorParam}::vector
       LIMIT $${limitParam}`,
      params,
    );
    return rows.map((row) => ({
      chunkId: String(row.chunkId),
      sourceId: String(row.sourceId),
      sourceType: row.sourceType as KnowledgeSourceType,
      sourceName: String(row.sourceName),
      content: String(row.content),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      score: Number(row.score ?? 0),
    }));
  }

  params.push(input.queryText!.trim());
  const textParam = params.length;
  params.push(limit);
  const limitParam = params.length;
  const rows = await query(
    `SELECT kc.id AS "chunkId", kc.source_id AS "sourceId",
            ks.source_type AS "sourceType", ks.name AS "sourceName",
            kc.content, kc.metadata,
            ts_rank_cd(to_tsvector('simple', kc.content),
                       websearch_to_tsquery('simple', $${textParam})) AS score
     FROM knowledge_chunks kc
     JOIN knowledge_sources ks ON ks.id = kc.source_id
     WHERE kc.org_id = $1 AND ks.org_id = $1
       AND ks.status = 'active'
       AND to_tsvector('simple', kc.content) @@ websearch_to_tsquery('simple', $${textParam})
       ${typeClause}
     ORDER BY score DESC
     LIMIT $${limitParam}`,
    params,
  );
  return rows.map((row) => ({
    chunkId: String(row.chunkId),
    sourceId: String(row.sourceId),
    sourceType: row.sourceType as KnowledgeSourceType,
    sourceName: String(row.sourceName),
    content: String(row.content),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    score: Number(row.score ?? 0),
  }));
}
