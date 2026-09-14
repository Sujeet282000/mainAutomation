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

/**
 * Split a prompt into per-step intent phrases. The separator alternative is
 * dropped during split, so the verb that introduces a step (", save to
 * Sheets", " and analyze") must be re-attached to the following phrase —
 * otherwise the matcher sees a verbless fragment ("to Sheets") that semantically
 * matches nothing. Two-pass approach: split, then re-attach any separator verb
 * that was consumed from the front of the NEXT chunk back onto it.
 */
const STEP_SEPARATORS = /(?:,\s*(?:then|and|also|next|send|save|notify|add|create|post|put|store|forward|route|copy|write|trigger|run|call|summarize|classify|extract|analyze|qualify|score|fetch|pull|get|retrieve|check|monitor|sync|update|upload|log|insert|enrich|email|message|tweet|scrape|convert|format|filter|translate|draft|generate)|\s+then\s+|\s+and\s+(?:send|save|notify|add|create|post|put|store|forward|route|copy|write|trigger|run|call|summarize|classify|extract|analyze|qualify|score|fetch|pull|get|retrieve|check|monitor|sync|update|upload|log|insert|enrich|email|message|tweet|scrape|convert|format|filter|translate|draft|generate)|\s*(?:→|->|=>)\s*|\s*;\s*)/i;

/** Verbs the splitter may have consumed; when a phrase starts with a
 *  preposition/article it has lost its verb and needs it re-attached. */
const SPLIT_VERBS = ["then", "and", "also", "next", "send", "save", "notify", "add", "create", "post", "put", "store", "forward", "route", "copy", "write", "trigger", "run", "call", "summarize", "classify", "extract", "analyze", "qualify", "score", "fetch", "pull", "get", "retrieve", "check", "monitor", "sync", "update", "upload", "log", "insert", "enrich", "email", "message", "tweet", "scrape", "convert", "format", "filter", "translate", "draft", "generate"];
const VERBLESS_START = /^(?:to|into|in|on|a|an|the)\b/i;

function recoverVerbBefore(prompt: string, phraseStart: number): string | null {
  const before = prompt.slice(0, phraseStart);
  const m = before.match(/(,\s*)?(\b(?:then|and)\s+)?([a-z]+)\s*$/i);
  if (!m) return null;
  const verb = m[3]?.toLowerCase();
  return verb && SPLIT_VERBS.includes(verb) ? verb : null;
}

interface IntentPhrase {
  text: string;
  index: number;
}

export function extractIntentPhrases(prompt: string): IntentPhrase[] {
  const parts = prompt.split(STEP_SEPARATORS).filter((p) => p.trim().length > 2);
  if (parts.length >= 2) {
    let offset = 0;
    const phrases: IntentPhrase[] = [];
    for (const part of parts) {
      const text = part.trim();
      const idx = prompt.indexOf(text, offset);
      const start = idx >= 0 ? idx : offset;
      offset = start + text.length;
      // If splitting consumed this phrase's verb (", save | to Sheets" →
      // "to Sheets"), re-attach the verb so the matcher sees "save to Sheets".
      if (VERBLESS_START.test(text)) {
        const verb = recoverVerbBefore(prompt, start);
        if (verb) {
          phrases.push({ text: `${verb} ${text}`, index: Math.max(0, start - verb.length - 1) });
          continue;
        }
      }
      phrases.push({ text, index: start });
    }
    return phrases;
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
  { re: /summariz(?:e|ing|y)|analyz|classif|extract|transform|enrich|qualify|score|parse|\bai\b|\bllm\b|chatgpt|gpt\b|openai/i, slug: "openai", kind: "action" },
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
  { re: /github\s+(?:action|create|open|close|comment\s+on)\s+(?:an?\s+)?(?:issue|pr|pull\s+request)/i, slug: "github", kind: "action" },
  { re: /(?:when|on)\s+(?:a\s+)?(?:new\s+)?github\s+(?:issue|pr|pull\s+request|push|release)/i, slug: "github", kind: "trigger" },
  { re: /jira\s+(?:action|create|issue|ticket)/i, slug: "jira", kind: "action" },
  { re: /linear\s+(?:action|create|issue)/i, slug: "linear", kind: "action" },
  { re: /http\s+(?:request|call|post|get|put|delete)|make\s+(?:an?\s+)?(?:http|api)\s+request|api\s+call|\bfetch\b[^.;]*\bapi\b|\bapi\b[^.;]*\b(?:fetch|request|call|get|pull)\b|\b(?:fetch|retrieve)\b[^.;]*\b(?:data|api|url|json|report)\b|\b(?:call|hit|query)\s+(?:an?\s+)?(?:api|url|endpoint|rest)\b|weather|stock\s+price|exchange\s+rate|api\s+status/i, slug: "http", kind: "action" },
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

/**
 * Preferred operation per (app, intent) — when a prompt names an app but the
 * semantic search ranks an odd operation first ("with AI" → openai:search),
 * fall back to the app's most sensible default action instead of the first
 * card or a search hit.
 */
const PREFERRED_OPERATION: Record<string, Record<string, string>> = {
  openai: { default: "analyze", "with ai": "analyze", analyze: "analyze", summarize: "summarize", classify: "classify", extract: "extract" },
  "google-sheets": { default: "append_row", "save to sheets": "append_row", sheets: "append_row" },
  slack: { default: "send_message" },
  gmail: { default: "send_email" },
};

/** Match a verbless AI phrase ("with AI", "AI step") to a concrete intent. */
function aiIntentOf(phrase: string): string {
  const lower = phrase.toLowerCase();
  if (/summariz/.test(lower)) return "summarize";
  if (/classif|categor|route|intent/.test(lower)) return "classify";
  if (/extract|pull|parse/.test(lower)) return "extract";
  if (/qualify|score|analyz|understand/.test(lower)) return "analyze";
  return "default";
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
      const cardFor = (operation: string) => cards.find((c) => c.piece === hint.slug && c.kind === hint.kind && c.operation === operation);
      // Deterministic intent override for AI phrases — "analyze with AI" and
      // bare "with AI" must resolve to a useful OpenAI action, never :search.
      if (hint.slug === "openai") {
        const intent = PREFERRED_OPERATION.openai[aiIntentOf(phrase)] ?? PREFERRED_OPERATION.openai.default;
        const preferred = cardFor(intent);
        if (preferred) return { slug: preferred.piece, operation: preferred.operation, label: preferred.display, kind: preferred.kind as "trigger" | "action" };
      }
      // Deterministic intent override for Sheets — "save/append/add to Sheets"
      // means a row write, never :find_row (the RAG top hit for save-phrases).
      if (hint.slug === "google-sheets" && hint.kind === "action") {
        const lower = phrase.toLowerCase();
        const sheetsIntent = /\b(?:create|new)\b[^.;]*\b(?:spreadsheet|sheet)\b/.test(lower) ? "create_spreadsheet"
          : /\b(?:save|append|add|log|store|write|insert|record)\b/.test(lower) ? "append_row"
          : null;
        if (sheetsIntent) {
          const preferred = cardFor(sheetsIntent);
          if (preferred) return { slug: preferred.piece, operation: preferred.operation, label: preferred.display, kind: preferred.kind as "trigger" | "action" };
        }
      }
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
      // Fallback: app's preferred default operation of the right kind
      const preferredOp = PREFERRED_OPERATION[hint.slug]?.default;
      const preferredCard = preferredOp ? cardFor(preferredOp) : undefined;
      if (preferredCard) {
        return { slug: preferredCard.piece, operation: preferredCard.operation, label: preferredCard.display, kind: preferredCard.kind as "trigger" | "action" };
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
      if (!match) continue;
      /* A phrase can carry BOTH a schedule cue and an action verb
         ("Every day at 8am check the API status") — the trigger pattern
         consumed the whole phrase, leaving no action step. When the matched
         trigger phrase still contains an action hint for a DIFFERENT app,
         extract the action as a second step. */
      if (match.kind === "trigger") {
        const actionPhrase = phrase.text.replace(/^.*?,\s*/, "");
        if (actionPhrase && actionPhrase !== phrase.text) {
          const actionMatch = await matchPhrase(actionPhrase, index, registry);
          if (actionMatch && actionMatch.kind === "action" && actionMatch.slug !== match.slug) {
            const keyT = `${match.slug}:${match.operation}`;
            if (!seen.has(keyT)) { seen.add(keyT); matched.push(match); }
            const keyA = `${actionMatch.slug}:${actionMatch.operation}`;
            if (!seen.has(keyA)) { seen.add(keyA); matched.push(actionMatch); }
            continue;
          }
        }
      }
      const key = `${match.slug}:${match.operation}`;
      if (!seen.has(key)) {
        seen.add(key);
        matched.push(match);
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
