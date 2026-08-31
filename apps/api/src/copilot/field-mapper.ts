/**
 * Schema-Aware Field Mapper — semantic field matching with confidence.
 *
 * Instead of simple regex-based field matching, this mapper:
 *   1. Extracts output schemas from upstream steps
 *   2. Extracts input schemas from downstream steps
 *   3. Uses semantic similarity (name + type + context) to match fields
 *   4. Returns confidence-scored mappings
 *
 * High-confidence mappings are auto-applied.
 * Medium-confidence mappings are suggested.
 * Low-confidence mappings are left for the user.
 */

import type { WorkflowGraph } from "@algoverge/shared";

// ── Types ───────────────────────────────────────────────────────────────────

export interface FieldSchema {
  key: string;
  label: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface FieldMapping {
  sourceStepId: string;
  sourceField: string;
  targetStepId: string;
  targetField: string;
  confidence: number;
  method: "name_match" | "type_match" | "semantic_match" | "context_match";
  expression: string;
}

export interface MappingResult {
  mappings: FieldMapping[];
  unmappedRequired: Array<{ stepId: string; field: string; type: string }>;
  confidence: number;
}

// ── Semantic Field Similarity ───────────────────────────────────────────────

/** Canonical field name aliases for semantic matching */
const FIELD_ALIASES: Record<string, string[]> = {
  email: ["email", "email_address", "from_email", "sender_email", "recipient_email", "to_email", "contact_email", "user_email"],
  name: ["name", "full_name", "display_name", "first_name", "last_name", "sender_name", "from_name", "author_name"],
  subject: ["subject", "title", "summary", "headline", "topic"],
  body: ["body", "content", "text", "message", "description", "snippet", "html_body", "plain_text"],
  phone: ["phone", "phone_number", "mobile", "telephone", "contact_phone"],
  company: ["company", "organization", "org", "company_name", "organization_name"],
  url: ["url", "link", "website", "web_url", "href"],
  date: ["date", "created_at", "updated_at", "timestamp", "time", "datetime", "received_at", "sent_at"],
  id: ["id", "record_id", "row_id", "item_id", "object_id"],
  channel: ["channel", "channel_id", "channel_name", "target_channel"],
  values: ["values", "data", "payload", "body", "content", "record"],
  spreadsheet_id: ["spreadsheet_id", "spreadsheetId", "sheet_id", "document_id"],
  status: ["status", "state", "stage", "condition", "result"],
};

/** Map from canonical name to possible aliases */
const ALIAS_INDEX: Map<string, string[]> = new Map();
for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
  ALIAS_INDEX.set(canonical, aliases);
}

function canonicalizeFieldName(key: string): string {
  const lower = key.toLowerCase().replace(/[_\-\s]+/g, "_");
  for (const [canonical, aliases] of ALIAS_INDEX) {
    if (aliases.includes(lower) || lower.includes(canonical)) return canonical;
  }
  return lower;
}

function fieldSimilarity(a: string, b: string): number {
  const canonA = canonicalizeFieldName(a);
  const canonB = canonicalizeFieldName(b);

  // Exact match
  if (a.toLowerCase() === b.toLowerCase()) return 1.0;

  // Canonical match
  if (canonA === canonB) return 0.9;

  // One contains the other
  if (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase())) return 0.7;

  // Partial token overlap
  const tokensA = a.toLowerCase().split(/[_\-\s]+/).filter(Boolean);
  const tokensB = b.toLowerCase().split(/[_\-\s]+/).filter(Boolean);
  const overlap = tokensA.filter((t) => tokensB.includes(t)).length;
  const total = new Set([...tokensA, ...tokensB]).size;
  if (overlap > 0) return 0.4 + (overlap / total) * 0.3;

  return 0;
}

function typeCompatible(sourceType: string, targetType: string): number {
  if (sourceType === targetType) return 1.0;
  const numeric = new Set(["number", "integer", "float", "int", "decimal"]);
  const text = new Set(["string", "text", "textarea", "richtext"]);
  const date = new Set(["date", "datetime", "timestamp", "time"]);
  const json = new Set(["json", "object", "array"]);

  if (numeric.has(sourceType) && numeric.has(targetType)) return 0.8;
  if (text.has(sourceType) && text.has(targetType)) return 0.8;
  if (date.has(sourceType) && date.has(targetType)) return 0.8;
  if (json.has(sourceType) && json.has(targetType)) return 0.8;

  // Text can receive anything (toString)
  if (text.has(targetType)) return 0.5;

  return 0;
}

// ── Schema Extraction ───────────────────────────────────────────────────────

function extractOutputFields(node: { appSlug: string; operation: string; config?: Record<string, unknown> }, catalog: Array<{ slug: string; operations: Array<{ key: string; outputSample?: Record<string, unknown>; inputFields?: Array<{ key: string; label: string; type: string; required: boolean }> }> }>): FieldSchema[] {
  const app = catalog.find((a) => a.slug === node.appSlug);
  if (!app) return [];
  const op = app.operations.find((o) => o.key === node.operation);
  if (!op) return [];

  if (op.outputSample) {
    return Object.entries(op.outputSample).map(([key, value]) => ({
      key,
      label: key.replace(/[_\-\s]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string",
      required: true,
    }));
  }

  return [];
}

function extractInputFields(node: { appSlug: string; operation: string }, catalog: Array<{ slug: string; operations: Array<{ key: string; inputFields?: Array<{ key: string; label: string; type: string; required: boolean }> }> }>): FieldSchema[] {
  const app = catalog.find((a) => a.slug === node.appSlug);
  if (!app) return [];
  const op = app.operations.find((o) => o.key === node.operation);
  if (!op?.inputFields) return [];

  return op.inputFields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
  }));
}

// ── Main Mapping Algorithm ──────────────────────────────────────────────────

/**
 * Map fields between consecutive workflow steps.
 * Returns scored mappings, unmapped required fields, and overall confidence.
 */
export function mapFields(
  graph: WorkflowGraph,
  catalog: Array<{
    slug: string;
    operations: Array<{
      key: string;
      outputSample?: Record<string, unknown>;
      inputFields?: Array<{ key: string; label: string; type: string; required: boolean }>;
    }>;
  }>,
): MappingResult {
  const allMappings: FieldMapping[] = [];
  const unmappedRequired: Array<{ stepId: string; field: string; type: string }> = [];
  const nodes = graph.nodes ?? [];
  const nodeOrder = nodes.map((n) => n.id);

  for (let i = 1; i < nodes.length; i++) {
    const upstream = nodes[i - 1];
    const downstream = nodes[i];

    const outputFields = extractOutputFields(upstream, catalog);
    const inputFields = extractInputFields(downstream, catalog);

    const mappedTargets = new Set<string>();

    for (const input of inputFields) {
      let bestMatch: FieldMapping | null = null;
      let bestScore = 0;

      for (const output of outputFields) {
        const nameSim = fieldSimilarity(output.key, input.key);
        const typeSim = typeCompatible(output.type, input.type);
        const score = nameSim * 0.7 + typeSim * 0.3;

        if (score > bestScore && score > 0.4) {
          bestScore = score;
          bestMatch = {
            sourceStepId: upstream.id,
            sourceField: output.key,
            targetStepId: downstream.id,
            targetField: input.key,
            confidence: score,
            method: nameSim > 0.7 ? "name_match" : nameSim > 0.4 ? "semantic_match" : "type_match",
            expression: `{{steps.${upstream.id}.${output.key}}}`,
          };
        }
      }

      if (bestMatch) {
        allMappings.push(bestMatch);
        mappedTargets.add(input.key);
      } else if (input.required) {
        unmappedRequired.push({ stepId: downstream.id, field: input.key, type: input.type });
      }
    }
  }

  // Overall confidence based on coverage
  const totalRequired = unmappedRequired.length + allMappings.filter((m) => m.confidence > 0.6).length;
  const mappedCount = allMappings.filter((m) => m.confidence > 0.6).length;
  const confidence = totalRequired > 0 ? mappedCount / totalRequired : 1;

  return {
    mappings: allMappings,
    unmappedRequired,
    confidence,
  };
}

/**
 * Apply high-confidence mappings to a workflow graph.
 * Only auto-applies mappings with confidence >= 0.7.
 */
export function applyMappings(
  graph: WorkflowGraph,
  mappings: FieldMapping[],
  minConfidence = 0.7,
): { graph: WorkflowGraph; applied: FieldMapping[] } {
  const next = JSON.parse(JSON.stringify(graph)) as WorkflowGraph;
  const applied: FieldMapping[] = [];

  for (const mapping of mappings) {
    if (mapping.confidence < minConfidence) continue;

    const targetNode = next.nodes.find((n) => n.id === mapping.targetStepId);
    if (!targetNode) continue;

    targetNode.config = targetNode.config ?? {};
    if (!targetNode.config[mapping.targetField] || targetNode.config[mapping.targetField] === "") {
      targetNode.config[mapping.targetField] = mapping.expression;
      applied.push(mapping);
    }
  }

  return { graph: next, applied };
}
