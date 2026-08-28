// =============================================================================
// SemanticFieldMapper — Maps fields between steps using semantic matching
// Builds data lineage and generates field mappings with confidence scores.
// =============================================================================

import type { AutomationPlan, PlanStep, DataRef, FieldMapping } from "@algoverge/shared";
import { APP_CATALOG } from "./catalog";

// ─── Semantic Aliases ────────────────────────────────────────────────────────

const FIELD_ALIASES: Record<string, string[]> = {
  email: ["email", "email_address", "emailAddress", "from_email", "sender_email", "contact_email", "customer_email", "user_email", "recipient_email", "to_email"],
  name: ["name", "full_name", "fullName", "display_name", "displayName", "first_name", "last_name", "sender_name", "contact_name"],
  subject: ["subject", "title", "headline", "topic"],
  body: ["body", "content", "text", "message", "description", "snippet", "summary", "html_body", "plain_body"],
  phone: ["phone", "phone_number", "phoneNumber", "mobile", "telephone"],
  company: ["company", "company_name", "companyName", "organization", "org_name"],
  date: ["date", "created_at", "updated_at", "timestamp", "time", "datetime", "sent_at", "received_at", "event_date"],
  url: ["url", "link", "href", "webhook_url", "callback_url"],
  id: ["id", "record_id", "entry_id", "item_id", "row_id", "ticket_id", "issue_id"],
  status: ["status", "state", "stage", "priority"],
  channel: ["channel", "channel_id", "channelId", "channel_name"],
  tags: ["tags", "labels", "categories"],
};

// ─── Output Schema Definitions ───────────────────────────────────────────────

/** Known output schemas for common apps. Used when catalog doesn't provide outputSample. */
const KNOWN_OUTPUTS: Record<string, Record<string, { type: string; label: string }>> = {
  gmail: {
    "from": { type: "string", label: "Sender" },
    "from.email": { type: "string", label: "Sender email" },
    "from.name": { type: "string", label: "Sender name" },
    "subject": { type: "string", label: "Subject" },
    "body": { type: "string", label: "Body" },
    "snippet": { type: "string", label: "Snippet" },
    "date": { type: "string", label: "Date" },
    "messageId": { type: "string", label: "Message ID" },
    "labels": { type: "array", label: "Labels" },
  },
  "google-sheets": {
    "row": { type: "number", label: "Row number" },
    "values": { type: "array", label: "Row values" },
  },
  slack: {
    "channel": { type: "string", label: "Channel" },
    "user": { type: "string", label: "User" },
    "text": { type: "string", label: "Message text" },
    "ts": { type: "string", label: "Timestamp" },
  },
  shopify: {
    "id": { type: "number", label: "Order ID" },
    "email": { type: "string", label: "Customer email" },
    "total_price": { type: "number", label: "Total price" },
    "created_at": { type: "string", label: "Created at" },
  },
};

// ─── Build Data Lineage ──────────────────────────────────────────────────────

/**
 * Build the data lineage for a plan: what data is available after each step.
 */
export function buildDataLineage(plan: AutomationPlan): DataRef[] {
  const available: DataRef[] = [];

  for (const step of plan.steps) {
    // Add the step's own output fields
    const outputFields = getStepOutputFields(step);
    for (const [fieldPath, fieldDef] of Object.entries(outputFields)) {
      available.push({
        stepId: step.id,
        field: fieldPath,
        type: fieldDef.type,
        label: fieldDef.label,
      });
    }
  }

  return available;
}

function getStepOutputFields(step: PlanStep): Record<string, { type: string; label: string }> {
  // Try catalog output sample first
  if (step.appSlug) {
    const app = APP_CATALOG.find((a) => a.slug === step.appSlug);
    if (app) {
      const op = app.operations.find((o) => o.key === step.operation);
      if (op?.outputSample) {
        return flattenOutputSample(op.outputSample);
      }
    }
    // Fall back to known outputs
    if (KNOWN_OUTPUTS[step.appSlug]) {
      return KNOWN_OUTPUTS[step.appSlug];
    }
  }

  // AI steps always output text
  if (step.type === "ai") {
    return {
      "result": { type: "string", label: "AI result" },
      "summary": { type: "string", label: "Summary" },
    };
  }

  return {};
}

function flattenOutputSample(sample: Record<string, unknown>, prefix = ""): Record<string, { type: string; label: string }> {
  const result: Record<string, { type: string; label: string }> = {};
  for (const [key, value] of Object.entries(sample)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenOutputSample(value as Record<string, unknown>, path));
    } else {
      result[path] = {
        type: Array.isArray(value) ? "array" : typeof value,
        label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      };
    }
  }
  return result;
}

// ─── Semantic Field Matching ─────────────────────────────────────────────────

/**
 * Generate field mappings for a step based on available data lineage.
 * Uses semantic alias matching and type compatibility.
 */
export function generateFieldMappings(
  step: PlanStep,
  availableData: DataRef[],
  previousStepOutputs: Map<string, Record<string, unknown>>
): FieldMapping[] {
  const mappings: FieldMapping[] = [];
  const app = step.appSlug ? APP_CATALOG.find((a) => a.slug === step.appSlug) : null;
  const op = app?.operations.find((o) => o.key === step.operation);

  if (!op?.inputFields) return mappings;

  for (const field of op.inputFields) {
    if (!field.required) continue;
    if (step.config[field.key]) continue; // Already has a static value

    // Find the best matching data source
    let bestMatch: DataRef | null = null;
    let bestConfidence = 0;

    const fieldAliases = FIELD_ALIASES[field.key] ?? [field.key.toLowerCase()];

    for (const dataRef of availableData) {
      // Don't reference data from the same step or future steps
      const dataStep = step.dependsOn.find((d) => d === dataRef.stepId);
      if (!dataStep && dataRef.stepId !== "trigger") continue;

      const dataPath = dataRef.field.toLowerCase();
      const confidence = calculateSemanticConfidence(field.key, field.type, dataRef, fieldAliases);

      if (confidence > bestConfidence && confidence >= 0.5) {
        bestConfidence = confidence;
        bestMatch = dataRef;
      }
    }

    if (bestMatch) {
      mappings.push({
        destinationField: field.key,
        source: bestMatch,
        confidence: bestConfidence,
        transformation: inferTransformation(field.type, bestMatch.type),
      });
    }
  }

  return mappings;
}

function calculateSemanticConfidence(
  fieldKey: string,
  fieldType: string,
  dataRef: DataRef,
  fieldAliases: string[]
): number {
  let confidence = 0;

  // Exact match
  const dataPath = dataRef.field.toLowerCase();
  if (fieldAliases.some((alias) => dataPath === alias || dataPath.endsWith(`.${alias}`))) {
    confidence = 0.95;
  }
  // Partial match
  else if (fieldAliases.some((alias) => dataPath.includes(alias))) {
    confidence = 0.75;
  }
  // Type-based heuristic
  else if (fieldType === "email" && dataRef.field.toLowerCase().includes("email")) {
    confidence = 0.85;
  }
  else if (fieldType === "string" && dataRef.type === "string") {
    confidence = 0.3; // Low confidence for generic string matching
  }

  return confidence;
}

function inferTransformation(targetType: string, sourceType: string): string | undefined {
  if (targetType === "number" && sourceType === "string") return "to_number";
  if (targetType === "string" && sourceType === "number") return "to_string";
  return undefined;
}
