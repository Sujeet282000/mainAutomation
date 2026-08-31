/**
 * Vector RAG graph construction.
 *
 * Splits a natural-language prompt into intent phrases, searches the catalog
 * with hybrid vector + lexical retrieval (Reciprocal Rank Fusion), and chains
 * the matched operations into a WorkflowGraph with correct trigger/action
 * semantics and edges.
 *
 * The CatalogIndex uses lexical embeddings (no external API) for fast
 * similarity search. When the index isn't ready, falls back to the piece
 * registry's card list with lexical overlap scoring.
 */

import type { WorkflowGraph, GraphNode } from "@algoverge/shared";
import { CatalogIndex } from "../pieces/catalog-index";
import { ModelGateway } from "@algoverge/model-gateway";
import type { PieceRegistry } from "../pieces/registry";

// ── Intent phrase splitting ─────────────────────────────────────────────────

const STEP_SEPARATORS = /(?:,\s*(?:then|and|also|next|send|save|notify|add|create|post|put|store|forward|route|copy|write|trigger|run|call|summarize|classify|extract|analyze|qualify|score)|\s+then\s+|\s+and\s+(?:send|save|notify|add|create|post|put|store|forward|route|copy|write|trigger|run|call|summarize|classify|extract|analyze|qualify|score)|\s*(?:→|->|=>)\s*|\s*;\s*)/i;

interface IntentPhrase {
  text: string;
  index: number;
}

export function extractIntentPhrases(prompt: string): IntentPhrase[] {
  const parts = prompt.split(STEP_SEPARATORS).filter((p) => p.trim().length > 2);
  if (parts.length >= 2) {
    let offset = 0;
    return parts.map((part) => {
      const text = part.trim();
      const idx = prompt.indexOf(text, offset);
      offset = idx + text.length;
      return { text, index: idx >= 0 ? idx : offset };
    });
  }
  const thenSplit = prompt.split(/\s+(?:then|and then|also|next)\s+/i).filter(Boolean);
  if (thenSplit.length >= 2) {
    let offset = 0;
    return thenSplit.map((part) => {
      const text = part.trim();
      const idx = prompt.indexOf(text, offset);
      offset = idx + text.length;
      return { text, index: idx >= 0 ? idx : offset };
    });
  }
  return [{ text: prompt.trim(), index: 0 }];
}

// ── Pattern-based intent detection ──────────────────────────────────────────

const INTENT_PATTERNS: Array<{ re: RegExp; slug: string; kind: "trigger" | "action" }> = [
  { re: /(?:when|on|if)\s+(?:a\s+)?(?:new\s+)?(?:g?mail|email)\s+(?:arrives|comes|is received|trigger)/i, slug: "gmail", kind: "trigger" },
  { re: /(?:when|on)\s+(?:a\s+)?(?:new\s+)?(?:form|submission)\s+(?:is\s+)?(?:submitted|received)/i, slug: "forms", kind: "trigger" },
  { re: /(?:when|on)\s+(?:a\s+)?(?:new\s+)?(?:row|spreadsheet)\s+(?:is\s+)?(?:added|created|updated)/i, slug: "google-sheets", kind: "trigger" },
  { re: /(?:when|on)\s+(?:a\s+)?(?:new\s+)?(?:calendar|event)\s+(?:is\s+)?(?:created)/i, slug: "google-calendar", kind: "trigger" },
  { re: /(?:when|on)\s+(?:a\s+)?(?:webhook|http)\s+(?:fires|hits|arrives)/i, slug: "webhook", kind: "trigger" },
  { re: /(?:every|schedule|cron|daily|hourly|weekly|monthly)/i, slug: "schedule", kind: "trigger" },
  { re: /summariz(?:e|ing|y)|analyze|classify|extract|transform|enrich|qualify|score|parse|ai\s+(?:step|process|analyze|summarize)/i, slug: "openai", kind: "action" },
  { re: /\bclaude\b|\banthropic\b|\bask\s+claude/i, slug: "anthropic", kind: "action" },
  { re: /\bgemini\b|\bgoogle\s+ai\b/i, slug: "gemini", kind: "action" },
  { re: /send\s+(?:to\s+)?slack|notify\s+(?:via\s+)?slack|post\s+to\s+slack|slack\s+message|slack\s+notification/i, slug: "slack", kind: "action" },
  { re: /send\s+(?:an?\s+)?email|email\s+(?:notification|message|send)|gmail\s+(?:send|action)/i, slug: "gmail", kind: "action" },
  { re: /send\s+(?:to\s+)?discord|discord\s+message/i, slug: "discord", kind: "action" },
  { re: /send\s+(?:to\s+)?telegram|telegram\s+message/i, slug: "telegram", kind: "action" },
  { re: /send\s+(?:sms|text)|twilio\s+message/i, slug: "twilio", kind: "action" },
  { re: /whatsapp\s+(?:send|message|notify)/i, slug: "whatsapp", kind: "action" },
  { re: /save\s+(?:to\s+)?(?:google\s+)?sheets?|append\s+(?:to\s+)?(?:google\s+)?sheets?|add\s+(?:to\s+)?(?:google\s+)?sheets?|google\s+sheets?\s+(?:action|append|add|create|write|save|store|row)/i, slug: "google-sheets", kind: "action" },
  { re: /save\s+(?:to\s+)?notion|notion\s+(?:action|create|add|page)/i, slug: "notion", kind: "action" },
  { re: /save\s+(?:to\s+)?airtable|airtable\s+(?:action|create|add|record)/i, slug: "airtable", kind: "action" },
  { re: /save\s+(?:to\s+)?(?:google\s+)?drive|upload\s+to\s+(?:google\s+)?drive/i, slug: "google-drive", kind: "action" },
  { re: /hubspot\s+(?:action|create|add|contact|deal)/i, slug: "hubspot", kind: "action" },
  { re: /salesforce\s+(?:action|create|add|lead|opportunity)/i, slug: "salesforce", kind: "action" },
  { re: /github\s+(?:action|create|issue|pull|pr|commit)/i, slug: "github", kind: "action" },
  { re: /jira\s+(?:action|create|issue|ticket)/i, slug: "jira", kind: "action" },
  { re: /linear\s+(?:action|create|issue)/i, slug: "linear", kind: "action" },
  { re: /http\s+(?:request|call|post|get|put|delete)|make\s+(?:an?\s+)?(?:http|api)\s+request|api\s+call/i, slug: "http", kind: "action" },
  { re: /webhook\s+(?:send|post|action)/i, slug: "http", kind: "action" },
];

// ── CatalogIndex singleton (awaitable with timeout) ─────────────────────────

let _indexPromise: Promise<CatalogIndex | null> | null = null;

/**
 * Get or initialize the CatalogIndex.
 * The first call triggers background initialization.
 * Subsequent calls return the same promise.
 * Uses lexical embeddings (no external API) — should be fast.
 */
function ensureIndex(registry: PieceRegistry): Promise<CatalogIndex | null> {
  if (_indexPromise) return _indexPromise;
  _indexPromise = (async () => {
    try {
      const idx = new CatalogIndex(registry, new ModelGateway());
      // Lexical embeddings are synchronous — reindex should be fast
      await Promise.race([
        idx.reindex(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("reindex timeout")), 5000)),
      ]);
      return idx;
    } catch {
      return null;
    }
  })();
  return _indexPromise;
}

/** Reset the singleton (for testing) */
export function _resetIndexSingleton() {
  _indexPromise = null;
}

// ── RAG matching ────────────────────────────────────────────────────────────

interface MatchedStep {
  slug: string;
  operation: string;
  label: string;
  kind: "trigger" | "action";
}

async function matchPhrase(
  phrase: string,
  index: CatalogIndex | null,
  registry: PieceRegistry,
): Promise<MatchedStep | null> {
  // Pattern-based fast path
  for (const hint of INTENT_PATTERNS) {
    if (hint.re.test(phrase)) {
      const cards = registry.cards();
      // Try RAG first for better operation selection
      if (index) {
        try {
          const hits = await index.search(phrase, hint.kind, 6);
          const appHit = hits.find((h) => h.piece === hint.slug);
          if (appHit) {
            return { slug: appHit.piece, operation: appHit.operation, label: appHit.display, kind: hint.kind };
          }
        } catch { /* fall through */ }
      }
      // Fallback: first operation of the right kind
      const fallback = cards.find((c) => c.piece === hint.slug && c.kind === hint.kind);
      if (fallback) {
        return { slug: fallback.piece, operation: fallback.operation, label: fallback.display, kind: hint.kind };
      }
      // Any operation for this app
      const any = cards.find((c) => c.piece === hint.slug);
      if (any) {
        return { slug: any.piece, operation: any.operation, label: any.display, kind: hint.kind };
      }
    }
  }

  // RAG semantic search — only when the index is loaded
  if (index) {
    try {
      const isTrigger = /\b(?:when|on|if|trigger|start|begin)\b/i.test(phrase);
      const kind = isTrigger ? ("trigger" as const) : ("action" as const);
      const hits = await index.search(phrase, kind, 5);
      if (hits.length > 0) {
        return { slug: hits[0].piece, operation: hits[0].operation, label: hits[0].display, kind };
      }
      const allHits = await index.search(phrase, undefined, 5);
      if (allHits.length > 0) {
        return { slug: allHits[0].piece, operation: allHits[0].operation, label: allHits[0].display, kind: allHits[0].kind as "trigger" | "action" };
      }
    } catch { /* fall through */ }
  }

  return null;
}

// ── Graph construction ──────────────────────────────────────────────────────

function makeNode(id: string, slug: string, operation: string, label: string, kind: "trigger" | "action", y: number): GraphNode {
  return { id, type: kind, appSlug: slug, operation, label, position: { x: 280, y }, config: {}, connectionId: null };
}

export function buildGraphFromMatches(steps: MatchedStep[]): WorkflowGraph {
  if (steps.length === 0) return { nodes: [], edges: [] };

  let triggerIdx = steps.findIndex((s) => s.kind === "trigger");
  if (triggerIdx === -1) triggerIdx = 0;

  const trigger = steps[triggerIdx];
  const actions = steps.filter((_, i) => i !== triggerIdx);

  const nodes: GraphNode[] = [makeNode("trigger", trigger.slug, trigger.operation, trigger.label, "trigger", 40)];
  const edges: WorkflowGraph["edges"] = [];
  let prev = "trigger";

  actions.forEach((step, i) => {
    const id = `${step.slug.replace(/[^a-z0-9]/gi, "")}-${step.operation}`;
    nodes.push(makeNode(id, step.slug, step.operation, step.label, "action", 200 + i * 160));
    edges.push({ id: `e-${prev}-${id}`, source: prev, target: id });
    prev = id;
  });

  return { nodes, edges };
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * RAG-based graph construction: splits prompt into intent phrases,
 * searches the catalog with hybrid retrieval, and builds a workflow graph.
 * Returns null if RAG cannot produce a valid graph with at least 2 nodes + edges.
 */
export async function ragGraphFromPrompt(
  prompt: string,
  registry: PieceRegistry,
): Promise<WorkflowGraph | null> {
  try {
    // Await the index with a reasonable timeout — lexical embeddings are fast
    const index = await ensureIndex(registry);
    const phrases = extractIntentPhrases(prompt);
    const matched: MatchedStep[] = [];
    const seen = new Set<string>();

    for (const phrase of phrases) {
      const match = await matchPhrase(phrase.text, index, registry);
      if (match) {
        const key = `${match.slug}:${match.operation}`;
        if (!seen.has(key)) {
          seen.add(key);
          matched.push(match);
        }
      }
    }

    if (matched.length === 0) return null;
    const graph = buildGraphFromMatches(matched);
    // Require a meaningful graph: at least trigger + action with edges
    if (graph.nodes.length < 2 || graph.edges.length === 0) return null;
    return graph;
  } catch {
    return null;
  }
}
