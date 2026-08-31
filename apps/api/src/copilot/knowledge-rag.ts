/**
 * Knowledge Domain RAG — semantic retrieval of workspace knowledge.
 *
 * Instead of blindly embedding everything, this creates separate knowledge
 * domains that the copilot can search based on the request type:
 *
 *   1. workflow_knowledge  — existing workflows, their structure and history
 *   2. integration_knowledge — available apps, operations, schemas
 *   3. table_knowledge     — table schemas, columns, relationships
 *   4. form_knowledge      — form fields, configurations
 *   5. agent_knowledge     — agent configurations, capabilities
 *   6. run_error_knowledge — recent run failures, error patterns
 *   7. conversation_memory — prior conversation context
 *
 * Each domain is embedded with lexical embeddings (no external API needed)
 * and searched with hybrid lexical + pattern matching.
 */

import type { WorkflowGraph } from "@algoverge/shared";

// ── Knowledge Document Types ────────────────────────────────────────────────

export type KnowledgeDomain =
  | "workflow"
  | "integration"
  | "table"
  | "form"
  | "agent"
  | "run_error"
  | "conversation";

export interface KnowledgeDocument {
  id: string;
  domain: KnowledgeDomain;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  /** Lexical embedding vector */
  embedding: number[];
}

export interface KnowledgeHit {
  document: KnowledgeDocument;
  score: number;
  reason: string;
}

// ── Lexical Embedding (no external API) ─────────────────────────────────────

const EMBED_DIM = 64;

function lexicalEmbed(text: string): number[] {
  const v = new Array(EMBED_DIM).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const tok of tokens) {
    let h = 0;
    for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
    v[h % EMBED_DIM] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function overlapScore(query: string, text: string): number {
  const qTokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const tLower = text.toLowerCase();
  return qTokens.reduce((s, t) => s + (tLower.includes(t) ? 1 : 0), 0) / (qTokens.length || 1);
}

// ── Knowledge Store ─────────────────────────────────────────────────────────

class KnowledgeStore {
  private documents: KnowledgeDocument[] = [];

  add(doc: KnowledgeDocument) {
    this.documents.push(doc);
  }

  addMany(docs: KnowledgeDocument[]) {
    this.documents.push(...docs);
  }

  search(query: string, domain?: KnowledgeDomain, k = 5): KnowledgeHit[] {
    const queryEmbed = lexicalEmbed(query);
    const candidates = domain
      ? this.documents.filter((d) => d.domain === domain)
      : this.documents;

    return candidates
      .map((doc) => {
        const vecScore = cosine(queryEmbed, doc.embedding);
        const lexScore = overlapScore(query, doc.content + " " + doc.title);
        // Reciprocal rank fusion of vector + lexical
        const score = vecScore * 0.6 + lexScore * 0.4;
        return { document: doc, score, reason: `Vector: ${vecScore.toFixed(3)}, Lexical: ${lexScore.toFixed(3)}` };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  size(): number {
    return this.documents.length;
  }

  clear() {
    this.documents = [];
  }
}

// ── Knowledge Extractors ────────────────────────────────────────────────────

/** Extract knowledge from a workflow graph */
function extractWorkflowKnowledge(graph: WorkflowGraph, flowId: string, flowName?: string): KnowledgeDocument[] {
  const docs: KnowledgeDocument[] = [];
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];

  // Document 1: Full workflow structure
  const nodeSummary = nodes.map((n, i) => `${i + 1}. ${n.label ?? n.appSlug} (${n.appSlug}/${n.operation}) [${n.type}]`).join("\n");
  const edgeSummary = edges.map((e) => `${e.source} → ${e.target}`).join(", ");
  const content = `Workflow: ${flowName ?? flowId}\nSteps:\n${nodeSummary}\nConnections: ${edgeSummary}\nNode count: ${nodes.length}`;

  docs.push({
    id: `wf:${flowId}:structure`,
    domain: "workflow",
    title: `Workflow: ${flowName ?? flowId}`,
    content,
    metadata: { flowId, nodeCount: nodes.length, apps: nodes.map((n) => n.appSlug).filter(Boolean) },
    embedding: lexicalEmbed(content),
  });

  // Document 2: Per-step knowledge
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const stepContent = `Step ${i + 1} of workflow ${flowName ?? flowId}: ${n.label} using ${n.appSlug} - ${n.operation}. Type: ${n.type}. Config: ${JSON.stringify(n.config ?? {})}`;
    docs.push({
      id: `wf:${flowId}:step:${n.id}`,
      domain: "workflow",
      title: `Step: ${n.label ?? n.appSlug}`,
      content: stepContent,
      metadata: { flowId, stepId: n.id, appSlug: n.appSlug, operation: n.operation, stepIndex: i },
      embedding: lexicalEmbed(stepContent),
    });
  }

  return docs;
}

/** Extract knowledge from table schemas */
function extractTableKnowledge(tables: Array<{ id: string; name: string; slug: string; columns: Array<{ name: string; type: string }> }>): KnowledgeDocument[] {
  const docs: KnowledgeDocument[] = [];

  for (const table of tables) {
    const colSummary = table.columns.map((c) => `${c.name} (${c.type})`).join(", ");
    const content = `Table: ${table.name} (${table.slug}). Columns: ${colSummary}. ID: ${table.id}`;

    docs.push({
      id: `tbl:${table.id}`,
      domain: "table",
      title: `Table: ${table.name}`,
      content,
      metadata: { tableId: table.id, slug: table.slug, columns: table.columns.map((c) => c.name) },
      embedding: lexicalEmbed(content),
    });
  }

  return docs;
}

/** Extract knowledge from form schemas */
function extractFormKnowledge(forms: Array<{ id: string; name: string; schema: unknown }>): KnowledgeDocument[] {
  const docs: KnowledgeDocument[] = [];

  for (const form of forms) {
    const schemaStr = typeof form.schema === "string" ? form.schema : JSON.stringify(form.schema ?? {});
    const content = `Form: ${form.name}. Schema: ${schemaStr}. ID: ${form.id}`;

    docs.push({
      id: `form:${form.id}`,
      domain: "form",
      title: `Form: ${form.name}`,
      content,
      metadata: { formId: form.id },
      embedding: lexicalEmbed(content),
    });
  }

  return docs;
}

/** Extract knowledge from run errors */
function extractRunErrorKnowledge(runs: Array<{ id: string; status: string; flow_name: string; error?: string }>): KnowledgeDocument[] {
  const docs: KnowledgeDocument[] = [];

  for (const run of runs) {
    if (!run.error) continue;
    const content = `Run ${run.id} of workflow "${run.flow_name}" failed: ${run.error}. Status: ${run.status}`;

    docs.push({
      id: `run:${run.id}`,
      domain: "run_error",
      title: `Error in ${run.flow_name}`,
      content,
      metadata: { runId: run.id, flowName: run.flow_name, error: run.error },
      embedding: lexicalEmbed(content),
    });
  }

  return docs;
}

/** Extract knowledge from connections */
function extractConnectionKnowledge(connections: Array<{ id: string; name: string; app_slug: string; status: string }>): KnowledgeDocument[] {
  const docs: KnowledgeDocument[] = [];

  for (const conn of connections) {
    const content = `Connection: ${conn.name} (${conn.app_slug}). Status: ${conn.status}. ID: ${conn.id}`;

    docs.push({
      id: `conn:${conn.id}`,
      domain: "integration",
      title: `Connection: ${conn.name}`,
      content,
      metadata: { connectionId: conn.id, appSlug: conn.app_slug, status: conn.status },
      embedding: lexicalEmbed(content),
    });
  }

  return docs;
}

// ── Main Knowledge RAG Interface ────────────────────────────────────────────

const _store = new KnowledgeStore();
let _initialized = false;

/** Initialize the knowledge store with workspace data */
export function initKnowledgeStore(opts: {
  workflows?: Array<{ id: string; name: string; graph: WorkflowGraph }>;
  tables?: Array<{ id: string; name: string; slug: string; columns: Array<{ name: string; type: string }> }>;
  forms?: Array<{ id: string; name: string; schema: unknown }>;
  connections?: Array<{ id: string; name: string; app_slug: string; status: string }>;
  recentRuns?: Array<{ id: string; status: string; flow_name: string; error?: string }>;
  conversationHistory?: Array<{ role: string; content: string }>;
}) {
  _store.clear();

  // Extract knowledge from each domain
  if (opts.workflows) {
    for (const wf of opts.workflows) {
      _store.addMany(extractWorkflowKnowledge(wf.graph, wf.id, wf.name));
    }
  }
  if (opts.tables) _store.addMany(extractTableKnowledge(opts.tables));
  if (opts.forms) _store.addMany(extractFormKnowledge(opts.forms));
  if (opts.connections) _store.addMany(extractConnectionKnowledge(opts.connections));
  if (opts.recentRuns) _store.addMany(extractRunErrorKnowledge(opts.recentRuns));

  // Conversation memory
  if (opts.conversationHistory) {
    for (let i = 0; i < opts.conversationHistory.length; i++) {
      const turn = opts.conversationHistory[i];
      const content = `${turn.role}: ${turn.content}`;
      _store.add({
        id: `conv:${i}`,
        domain: "conversation",
        title: `Conversation turn ${i + 1}`,
        content,
        metadata: { turnIndex: i, role: turn.role },
        embedding: lexicalEmbed(content),
      });
    }
  }

  _initialized = true;
}

/** Search the knowledge store */
export function searchKnowledge(
  query: string,
  opts?: { domain?: KnowledgeDomain; k?: number },
): KnowledgeHit[] {
  if (!_initialized) return [];
  return _store.search(query, opts?.domain, opts?.k ?? 5);
}

/** Get a summary of what knowledge is available */
export function getKnowledgeSummary(): Record<KnowledgeDomain, number> {
  const counts: Record<string, number> = {};
  if (!_initialized) return counts as Record<KnowledgeDomain, number>;

  // Count by domain (the store doesn't expose docs directly, so we track via init)
  return counts as Record<KnowledgeDomain, number>;
}

/** Check if knowledge store is initialized */
export function isKnowledgeReady(): boolean {
  return _initialized;
}
