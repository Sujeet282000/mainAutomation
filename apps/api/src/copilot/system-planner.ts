/**
 * System Planner — product-aware business-intent → system architecture.
 *
 * Given a natural-language business request, this planner:
 *   1. Identifies which platform products are needed (Forms, Tables, etc.)
 *   2. Selects capabilities for each product
 *   3. Designs the system architecture with dependencies
 *   4. Produces a structured plan for the copilot engine to execute
 *
 * The planner uses the Capability Registry for product matching
 * and the Knowledge RAG for workspace context.
 */

import { matchProducts, matchCapabilities, isCrossProductSystem, getProduct, type ProductType } from "./capability-registry";
import { searchKnowledge, type KnowledgeHit } from "./knowledge-rag";
import type { WorkflowGraph } from "@algoverge/shared";

// ── Plan Types ──────────────────────────────────────────────────────────────

export interface SystemPlanStep {
  order: number;
  product: ProductType;
  capability: string;
  description: string;
  appHint?: string;
  dependsOn: number[];
  confidence: number;
}

export interface SystemPlan {
  /** The user's business goal */
  goal: string;
  /** Human-readable summary */
  summary: string;
  /** Products involved */
  products: ProductType[];
  /** Entry point product */
  entryProduct: ProductType;
  /** Whether this is a cross-product system */
  isSystem: boolean;
  /** Ordered steps with dependencies */
  steps: SystemPlanStep[];
  /** Required connections */
  connections: string[];
  /** Missing information */
  missingInfo: string[];
  /** Confidence 0-1 */
  confidence: number;
  /** Knowledge hits that informed the plan */
  knowledgeContext: string[];
}

// ── Step Templates ──────────────────────────────────────────────────────────

interface StepTemplate {
  product: ProductType;
  capability: string;
  description: string;
  appHint?: string;
  dependsOnPattern: "none" | "previous" | "specific";
}

/**
 * Predefined step templates for common business patterns.
 * The system planner selects from these based on matched capabilities.
 */
const SYSTEM_TEMPLATES: Record<string, StepTemplate[]> = {
  // Lead management: form → table → AI → notification
  lead_management: [
    { product: "form", capability: "create_form", description: "Lead capture form", dependsOnPattern: "none" },
    { product: "table", capability: "create_table", description: "Lead records storage", dependsOnPattern: "previous" },
    { product: "agent", capability: "ai_qualify", description: "AI lead qualification", dependsOnPattern: "previous" },
    { product: "notification", capability: "send_slack", description: "Sales notification", dependsOnPattern: "previous" },
  ],
  // Customer support: form → table → AI → notification
  customer_support: [
    { product: "form", capability: "create_form", description: "Support request form", dependsOnPattern: "none" },
    { product: "table", capability: "create_table", description: "Ticket tracking", dependsOnPattern: "previous" },
    { product: "agent", capability: "ai_classify", description: "AI ticket classification", dependsOnPattern: "previous" },
    { product: "notification", capability: "send_slack", description: "Support alert", dependsOnPattern: "previous" },
  ],
  // Data pipeline: trigger → AI → table → notification
  data_pipeline: [
    { product: "automation", capability: "create_workflow", description: "Data trigger", dependsOnPattern: "none" },
    { product: "agent", capability: "ai_extract", description: "AI data extraction", dependsOnPattern: "previous" },
    { product: "table", capability: "insert_record", description: "Store extracted data", dependsOnPattern: "previous" },
    { product: "notification", capability: "send_email", description: "Completion notification", dependsOnPattern: "previous" },
  ],
};

// ── Pattern Detection ───────────────────────────────────────────────────────

function detectSystemPattern(prompt: string): string | null {
  const lower = prompt.toLowerCase();
  if (/\b(lead|prospect|sales|pipeline|customer)\b/i.test(lower) && /\b(manage|track|capture|collect|qualify|system|notification|alert|ai)\b/i.test(lower)) {
    return "lead_management";
  }
  if (/\b(support|ticket|help|issue|bug|customer)\b/i.test(lower) && /\b(track|manage|handle|resolve|ticket|system|classify|ai)\b/i.test(lower)) {
    return "customer_support";
  }
  if (/\b(data|extract|process|transform|lead|qualification)\b/i.test(lower) && /\b(pipeline|ingest|import|sync|system|notify|alert)\b/i.test(lower)) {
    return "data_pipeline";
  }
  return null;
}

// ── System Planner ──────────────────────────────────────────────────────────

export function planSystem(opts: {
  prompt: string;
  graph?: WorkflowGraph | null;
  knowledge?: KnowledgeHit[];
}): SystemPlan {
  const { prompt, graph } = opts;

  // Step 1: Match products
  const productMatches = matchProducts(prompt);
  const capabilityMatches = matchCapabilities(prompt);
  const isSystem = isCrossProductSystem(prompt);

  // Step 2: Detect if there's a predefined system pattern
  const systemPattern = detectSystemPattern(prompt);

  // Step 3: Build steps
  let steps: SystemPlanStep[] = [];

  if (systemPattern && SYSTEM_TEMPLATES[systemPattern]) {
    // Use predefined template
    const template = SYSTEM_TEMPLATES[systemPattern];
    steps = template.map((t, i) => ({
      order: i + 1,
      product: t.product,
      capability: t.capability,
      description: t.description,
      appHint: t.appHint,
      dependsOn: t.dependsOnPattern === "none" ? [] : [i],
      confidence: 0.85,
    }));
  } else {
    // Build from matched capabilities
    let order = 0;
    for (const capMatch of capabilityMatches.slice(0, 6)) {
      order++;
      steps.push({
        order,
        product: capMatch.product,
        capability: capMatch.capability.id,
        description: capMatch.capability.description,
        dependsOn: order > 1 ? [order - 1] : [],
        confidence: capMatch.confidence,
      });
    }

    // Add products that were matched but have no specific capability
    const usedProducts = new Set(steps.map((s) => s.product));
    for (const prodMatch of productMatches.slice(0, 4)) {
      if (usedProducts.has(prodMatch.product)) continue;
      const product = getProduct(prodMatch.product);
      if (!product || !product.isEntryPoint) continue;
      order++;
      steps.push({
        order,
        product: prodMatch.product,
        capability: `${prodMatch.product}_create`,
        description: product.description,
        dependsOn: order > 1 ? [order - 1] : [],
        confidence: 0.6,
      });
    }

    // If still no steps, try to generate from product keywords
    if (steps.length === 0 && productMatches.length > 0) {
      let order = 0;
      for (const prodMatch of productMatches.slice(0, 4)) {
        order++;
        const product = getProduct(prodMatch.product);
        steps.push({
          order,
          product: prodMatch.product,
          capability: `${prodMatch.product}_auto`,
          description: product?.description ?? prodMatch.product,
          dependsOn: order > 1 ? [order - 1] : [],
          confidence: 0.5,
        });
      }
    }
  }

  // Step 4: Identify connections needed
  const connections: string[] = [];
  const products = [...new Set(steps.map((s) => s.product))];
  for (const product of products) {
    const def = getProduct(product);
    if (!def) continue;
    // Map product types to common connection apps
    const connMap: Record<string, string[]> = {
      form: ["forms"],
      table: ["google-sheets", "airtable"],
      automation: ["gmail", "slack", "google-calendar"],
      notification: ["slack", "gmail", "discord", "telegram"],
      agent: ["openai", "anthropic"],
    };
    const appConns = connMap[product] ?? [];
    connections.push(...appConns);
  }

  // Step 5: Check for missing information
  const missingInfo: string[] = [];
  if (steps.length === 0) {
    missingInfo.push("Could not determine what to build. Try being more specific about the trigger and actions.");
  }
  if (products.includes("form") && !steps.some((s) => s.capability === "create_form")) {
    missingInfo.push("Form fields are needed. Describe what data to collect.");
  }

  // Step 6: Generate summary
  const productNames = products.map((p) => getProduct(p)?.name ?? p);
  const summary = isSystem
    ? `I'll build a ${productNames.join(" + ")} system: ${steps.map((s) => s.description).join(" → ")}`
    : steps.length > 0
      ? `I'll create ${steps.map((s) => s.description).join(" → ")}`
      : "I'll help you with your request.";

  // Step 7: Get relevant knowledge context
  const knowledgeContext: string[] = [];
  if (opts.knowledge) {
    for (const hit of opts.knowledge.slice(0, 3)) {
      knowledgeContext.push(hit.document.title);
    }
  }

  // Step 8: Determine entry product
  const entryProduct = steps.length > 0 ? steps[0].product : "automation";

  return {
    goal: prompt.slice(0, 200),
    summary,
    products,
    entryProduct,
    isSystem,
    steps,
    connections: [...new Set(connections)],
    missingInfo,
    confidence: steps.length > 0 ? Math.min(0.9, 0.5 + steps.length * 0.1) : 0.3,
    knowledgeContext,
  };
}

/**
 * Convert a SystemPlan to a WorkflowGraph using the catalog.
 * This bridges the product-aware planner to the existing graph builder.
 */
export function planToGraph(plan: SystemPlan, catalog: Array<{ slug: string; name: string; operations: Array<{ key: string; name: string; type: string }> }>): WorkflowGraph {
  const nodes: WorkflowGraph["nodes"] = [];
  const edges: WorkflowGraph["edges"] = [];

  // Map product types to likely catalog apps
  const productToApp: Record<ProductType, string> = {
    form: "forms",
    table: "google-sheets",
    automation: "gmail",
    canvas: "manual",
    agent: "openai",
    chatbot: "webhook",
    approval: "manual",
    notification: "slack",
    interface: "http",
    knowledge: "openai",
  };

  // Map capabilities to likely operations
  const capToOp: Record<string, { slug: string; op: string; asTrigger: boolean }> = {
    create_form: { slug: "forms", op: "new_submission", asTrigger: true },
    collect_submission: { slug: "forms", op: "new_submission", asTrigger: true },
    create_table: { slug: "google-sheets", op: "append_row", asTrigger: false },
    insert_record: { slug: "google-sheets", op: "append_row", asTrigger: false },
    search_records: { slug: "google-sheets", op: "read_sheet", asTrigger: false },
    create_workflow: { slug: "gmail", op: "new_email", asTrigger: true },
    add_condition: { slug: "filter", op: "filter", asTrigger: false },
    add_delay: { slug: "delay", op: "delay", asTrigger: false },
    ai_summarize: { slug: "openai", op: "summarize", asTrigger: false },
    ai_classify: { slug: "openai", op: "classify", asTrigger: false },
    ai_extract: { slug: "openai", op: "extract", asTrigger: false },
    ai_qualify: { slug: "openai", op: "score", asTrigger: false },
    send_slack: { slug: "slack", op: "send_message", asTrigger: false },
    send_email: { slug: "gmail", op: "send_email", asTrigger: false },
  };

  for (const step of plan.steps) {
    const mapping = capToOp[step.capability] ?? { slug: productToApp[step.product] ?? "http", op: "request", asTrigger: false };

    // Validate against catalog
    const app = catalog.find((a) => a.slug === mapping.slug);
    const op = app?.operations.find((o) => o.key === mapping.op);

    const id = `${step.product}-${step.order}`;
    nodes.push({
      id,
      type: step.order === 1 && mapping.asTrigger ? "trigger" : "action",
      appSlug: app?.slug ?? mapping.slug,
      operation: op?.key ?? mapping.op,
      label: op?.name ?? step.description,
      position: { x: 280, y: 40 + (step.order - 1) * 160 },
      config: {},
      connectionId: null,
    });

    if (step.order > 1) {
      const prevId = `${step.product}-${step.order - 1}`;
      edges.push({ id: `e-${prevId}-${id}`, source: prevId, target: id });
    }
  }

  return { nodes, edges };
}
