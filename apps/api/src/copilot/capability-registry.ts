/**
 * Capability Registry — first-class platform products with typed capabilities.
 *
 * The Copilot uses this to understand that a user request may require
 * Forms, Tables, Automations, Canvas, Agents, or a combination.
 *
 * Each product exposes capabilities that the system planner can select.
 * The registry is consumed by:
 *   1. The system planner (business intent → product selection)
 *   2. The copilot engine (product → capability → graph construction)
 *   3. The frontend (product badges, connection warnings, step picker)
 */

// ── Product Definitions ─────────────────────────────────────────────────────

export type ProductType =
  | "form"
  | "table"
  | "automation"
  | "canvas"
  | "agent"
  | "chatbot"
  | "approval"
  | "notification"
  | "interface"
  | "knowledge";

export interface ProductCapability {
  id: string;
  name: string;
  description: string;
  /** Intents that trigger this capability */
  triggers: RegExp[];
  /** Required products for this capability to work */
  requires: ProductType[];
  /** Optional products that enhance this capability */
  enhances: ProductType[];
  /** Confidence boost when this capability matches */
  confidenceBoost: number;
}

export interface ProductDefinition {
  type: ProductType;
  name: string;
  description: string;
  icon: string;
  /** Keywords that indicate this product is needed */
  keywords: RegExp[];
  /** Capabilities this product can provide */
  capabilities: ProductCapability[];
  /** Products that commonly pair with this one */
  pairsWith: ProductType[];
  /** When this product should be used as the entry point */
  isEntryPoint: boolean;
}

// ── Product Registry ────────────────────────────────────────────────────────

export const PRODUCTS: ProductDefinition[] = [
  {
    type: "form",
    name: "Forms",
    description: "Collect structured data from users",
    icon: "\ud83d\udcdd",
    keywords: [
      /\bform\b/i, /\bsubmission\b/i, /\bsubmitted\b/i,
      /\bcollect\b.*\b(data|leads?|info|information|entries?)\b/i,
      /\binput\b.*\bform\b/i, /\bcapture\b.*\b(data|leads?|info)\b/i,
      /\bweb\s*form\b/i, /\blanding\s*page\b/i,
      /\bsign\s*up\b/i, /\bregister\b/i, /\bintake\b/i,
    ],
    capabilities: [
      {
        id: "create_form",
        name: "Create Form",
        description: "Create a new form to collect data",
        triggers: [/\bcreate\b.*\bform\b/i, /\bbuild\b.*\bform\b/i, /\bmake\b.*\bform\b/i, /\bnew\b.*\bform\b/i],
        requires: [],
        enhances: ["table", "automation"],
        confidenceBoost: 0.3,
      },
      {
        id: "collect_submission",
        name: "Collect Submissions",
        description: "Process incoming form submissions",
        triggers: [/\bform\b.*\bsubmit/i, /\bsubmission\b/i, /\bwhen\b.*\bform\b/i, /\bnew\b.*\bform\b.*\bresponse\b/i],
        requires: [],
        enhances: ["automation", "table"],
        confidenceBoost: 0.2,
      },
    ],
    pairsWith: ["table", "automation", "notification"],
    isEntryPoint: true,
  },
  {
    type: "table",
    name: "Tables",
    description: "Store and manage structured data",
    icon: "\ud83d\uddc3",
    keywords: [
      /\btable\b/i, /\brecord/i, /\brow/i, /\bcolumn/i,
      /\bstore\b.*\b(data|leads?|info|records?|entries?)\b/i,
      /\bsave\b.*\bto\b.*\b(table|sheet|database)\b/i,
      /\bdatabase\b/i, /\bCRM\b/i, /\btracker\b/i,
      /\bspreadsheet\b/i, /\bsheets?\b/i,
    ],
    capabilities: [
      {
        id: "create_table",
        name: "Create Table",
        description: "Create a new table to store records",
        triggers: [/\bcreate\b.*\btable\b/i, /\bnew\b.*\btable\b/i, /\bbuild\b.*\btable\b/i],
        requires: [],
        enhances: ["automation", "form"],
        confidenceBoost: 0.3,
      },
      {
        id: "insert_record",
        name: "Insert Record",
        description: "Add a new record to a table",
        triggers: [/\badd\b.*\brecord/i, /\binsert\b.*\brow/i, /\bstore\b.*\bin\b.*\btable\b/i],
        requires: [],
        enhances: ["automation"],
        confidenceBoost: 0.2,
      },
      {
        id: "search_records",
        name: "Search Records",
        description: "Search for records in a table",
        triggers: [/\bsearch\b.*\b(record|table|row)/i, /\bfind\b.*\b(record|row)/i, /\blookup\b/i],
        requires: [],
        enhances: ["automation", "agent"],
        confidenceBoost: 0.2,
      },
    ],
    pairsWith: ["form", "automation", "agent"],
    isEntryPoint: true,
  },
  {
    type: "automation",
    name: "Automations",
    description: "Event-driven workflow automation",
    icon: "\u26a1",
    keywords: [
      /\b(when|whenever|if|then)\b/i,
      /\bautomate\b/i, /\bworkflow\b/i, /\bzap\b/i, /\bpipeline\b/i,
      /\btrigger\b/i, /\baction\b/i,
      /\bcondition\b/i, /\bbranch\b/i, /\brouter\b/i,
      /\bloop\b/i, /\bdelay\b/i,
    ],
    capabilities: [
      {
        id: "create_workflow",
        name: "Create Workflow",
        description: "Create an automation workflow",
        triggers: [/\bcreate\b.*\b(workflow|automation|zap)/i, /\bbuild\b.*\b(workflow|automation)/i],
        requires: [],
        enhances: ["form", "table", "agent"],
        confidenceBoost: 0.3,
      },
      {
        id: "add_condition",
        name: "Add Condition",
        description: "Add a conditional branch",
        triggers: [/\b(if|else|condition|branch|routing)\b/i],
        requires: [],
        enhances: ["automation"],
        confidenceBoost: 0.2,
      },
      {
        id: "add_delay",
        name: "Add Delay",
        description: "Add a time delay between steps",
        triggers: [/\bdelay\b/i, /\bwait\b.*\b(\d+\s*(min|hour|day|second))/i, /\btimeout\b/i],
        requires: [],
        enhances: ["automation"],
        confidenceBoost: 0.15,
      },
    ],
    pairsWith: ["form", "table", "agent", "notification"],
    isEntryPoint: true,
  },
  {
    type: "agent",
    name: "AI Agents",
    description: "Autonomous AI processing and reasoning",
    icon: "\ud83e\udd16",
    keywords: [
      /\bai\b/i, /\bartificial\s*intelligence\b/i, /\bmachine\s*learning\b/i,
      /\bsummariz/i, /\bclassify\b/i, /\bextract\b/i, /\btransform\b/i,
      /\benrich\b/i, /\bqualify\b/i, /\bscore\b/i, /\bparse\b/i,
      /\banalyz/i, /\bprocess\b.*\bai\b/i,
      /\bopenai\b/i, /\bchatgpt\b/i, /\bclaude\b/i, /\bgemini\b/i,
      /\bllm\b/i,
    ],
    capabilities: [
      {
        id: "ai_summarize",
        name: "AI Summarize",
        description: "Summarize content using AI",
        triggers: [/\bsummariz/i, /\bsummary\b/i, /\bdigest\b/i],
        requires: [],
        enhances: ["automation"],
        confidenceBoost: 0.3,
      },
      {
        id: "ai_classify",
        name: "AI Classify",
        description: "Classify or categorize data using AI",
        triggers: [/\bclassif/i, /\bcategoriz/i, /\blabel\b/i, /\bscore\b/i],
        requires: [],
        enhances: ["automation", "table"],
        confidenceBoost: 0.25,
      },
      {
        id: "ai_extract",
        name: "AI Extract",
        description: "Extract structured data from unstructured text",
        triggers: [/\bextract\b/i, /\bpull\b.*\bout\b/i, /\bparse\b/i],
        requires: [],
        enhances: ["automation", "table"],
        confidenceBoost: 0.2,
      },
      {
        id: "ai_qualify",
        name: "AI Qualify",
        description: "Score and qualify leads or data using AI",
        triggers: [/\bqualify\b/i, /\bqualification\b/i, /\blead\s*score/i, /\bscore.*lead/i],
        requires: [],
        enhances: ["automation", "table"],
        confidenceBoost: 0.3,
      },
    ],
    pairsWith: ["automation", "table", "notification"],
    isEntryPoint: false,
  },
  {
    type: "notification",
    name: "Notifications",
    description: "Send alerts and notifications",
    icon: "\ud83d\udd14",
    keywords: [
      /\bnotif/i, /\balert\b/i, /\btell\b/i, /\binform\b/i, /\blet.*know\b/i,
      /\bremind\b/i, /\bmessage\b/i,
      /\bsend\b.*\bto\b.*\b(slack|email|sms|discord|telegram|whatsapp)\b/i,
      /\bslack\b/i, /\bemail\b/i, /\bsms\b/i, /\bdiscord\b/i, /\btelegram\b/i, /\bwhatsapp\b/i,
    ],
    capabilities: [
      {
        id: "send_slack",
        name: "Send Slack Message",
        description: "Send a message to a Slack channel",
        triggers: [/\bslack\b.*\b(send|message|notif|post)/i, /\bsend\b.*\bslack\b/i, /\bpost\b.*\bslack\b/i],
        requires: [],
        enhances: ["automation"],
        confidenceBoost: 0.25,
      },
      {
        id: "send_email",
        name: "Send Email",
        description: "Send an email notification",
        triggers: [/\bemail\b.*\b(send|notif|message)/i, /\bsend\b.*\bemail\b/i, /\bemail\b.*\bnotif/i],
        requires: [],
        enhances: ["automation"],
        confidenceBoost: 0.2,
      },
    ],
    pairsWith: ["automation", "agent", "table"],
    isEntryPoint: false,
  },
  {
    type: "canvas",
    name: "Canvas",
    description: "Cross-product business system builder",
    icon: "\ud83d\udda5",
    keywords: [
      /\bsystem\b/i, /\bcomplete\b.*\bsolution\b/i, /\bend.to.end\b/i,
      /\bentire\b/i, /\bfull\b.*\bpipeline\b/i,
      /\bmanagement\b.*\bsystem\b/i, /\bonboarding\b.*\bsystem\b/i,
      /\bsales\b.*\bpipeline\b/i, /\bsupport\b.*\bsystem\b/i,
    ],
    capabilities: [],
    pairsWith: ["form", "table", "automation", "agent", "notification"],
    isEntryPoint: false, // Canvas is selected by the system planner, not directly
  },
  {
    type: "chatbot",
    name: "Chatbots",
    description: "Conversational AI interface",
    icon: "\ud83d\udcac",
    keywords: [
      /\bchatbot\b/i, /\bchat\s*bot\b/i, /\bconversational\b/i,
      /\bsupport\s*bot\b/i, /\bFAQ\s*bot\b/i,
      /\bchat\s*with\b/i, /\btalk\s*to\b/i,
    ],
    capabilities: [],
    pairsWith: ["agent", "knowledge", "automation"],
    isEntryPoint: true,
  },
  {
    type: "approval",
    name: "Approvals",
    description: "Human-in-the-loop approval workflows",
    icon: "\u2705",
    keywords: [
      /\bapprov/i, /\bconfirm\b/i, /\breview\b.*\brequired\b/i,
      /\bhuman.*in.*loop\b/i, /\bmanual.*review\b/i,
    ],
    capabilities: [],
    pairsWith: ["automation", "agent"],
    isEntryPoint: false,
  },
  {
    type: "interface",
    name: "Interfaces",
    description: "Custom UIs, dashboards, and portals",
    icon: "\ud83d\udda5",
    keywords: [
      /\binterface\b/i, /\bportal\b/i, /\bdashboard\b/i,
      /\bcustomer\s*(portal|view|page)\b/i, /\bemployee\s*(portal|view)\b/i,
      /\badmin\s*panel\b/i,
    ],
    capabilities: [],
    pairsWith: ["form", "table", "agent"],
    isEntryPoint: true,
  },
  {
    type: "knowledge",
    name: "Knowledge",
    description: "Knowledge bases and document stores for AI",
    icon: "\ud83d\udcda",
    keywords: [
      /\bknowledge\b/i, /\bdocument\b/i, /\bdocs?\b/i,
      /\bFAQ\b/i, /\bknowledge\s*base\b/i, /\btraining\s*data\b/i,
    ],
    capabilities: [],
    pairsWith: ["agent", "chatbot"],
    isEntryPoint: false,
  },
];

// ── Registry API ────────────────────────────────────────────────────────────

/** Get a product definition by type */
export function getProduct(type: ProductType): ProductDefinition | undefined {
  return PRODUCTS.find((p) => p.type === type);
}

/** Get all product types */
export function getAllProductTypes(): ProductType[] {
  return PRODUCTS.map((p) => p.type);
}

/** Match products against a user prompt */
export function matchProducts(prompt: string): Array<{ product: ProductType; score: number; matchedKeywords: string[] }> {
  const results: Array<{ product: ProductType; score: number; matchedKeywords: string[] }> = [];

  for (const product of PRODUCTS) {
    const matchedKeywords: string[] = [];
    let score = 0;

    for (const keyword of product.keywords) {
      if (keyword.test(prompt)) {
        score += 1;
        matchedKeywords.push(keyword.source);
      }
    }

    if (score > 0) {
      results.push({ product: product.type, score, matchedKeywords });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/** Match capabilities against a user prompt */
export function matchCapabilities(prompt: string): Array<{ product: ProductType; capability: ProductCapability; confidence: number }> {
  const results: Array<{ product: ProductType; capability: ProductCapability; confidence: number }> = [];

  for (const product of PRODUCTS) {
    for (const cap of product.capabilities) {
      for (const trigger of cap.triggers) {
        if (trigger.test(prompt)) {
          results.push({ product: product.type, capability: cap, confidence: 0.5 + cap.confidenceBoost });
          break;
        }
      }
    }
  }

  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

/**
 * Determine if a request is a cross-product business system.
 * Not just "3 products = canvas" — checks for business-process patterns.
 */
export function isCrossProductSystem(prompt: string): boolean {
  const lower = prompt.toLowerCase();

  // Explicit system patterns
  if (/\b(system|complete|entire|end.to.end|full|build|create)\b/i.test(lower) && /\b(management|pipeline|process|solution|setup|onboarding|qualification|automation)\b/i.test(lower)) {
    return true;
  }

  // Multi-product patterns: collects + stores + processes
  const productHits = matchProducts(prompt);
  if (productHits.length >= 2) {
    // Must involve data flow: at least one entry + one storage + one action
    const types = new Set(productHits.map((h) => h.product));
    const hasEntry = types.has("form") || types.has("interface") || types.has("chatbot");
    const hasStorage = types.has("table") || types.has("knowledge");
    const hasAction = types.has("automation") || types.has("agent") || types.has("notification");
    if (hasEntry && hasStorage && hasAction) return true;
    // Also: automation + agent + notification = system
    if (types.has("automation") && (types.has("agent") || types.has("notification"))) return true;
    // Also: form + agent + notification = system
    if (types.has("form") && types.has("agent") && types.has("notification")) return true;
  }

  // Business process patterns
  if (/\b(collect|capture).*\b(store|save|keep).*\b(process|analyze|qualify|route|send|notify)\b/i.test(lower)) {
    return true;
  }

  return false;
}

/**
 * Get the recommended entry surface for a set of products.
 */
export function getEntryPoint(products: ProductType[]): ProductType {
  if (products.includes("form")) return "form";
  if (products.includes("chatbot")) return "chatbot";
  if (products.includes("interface")) return "interface";
  if (products.includes("automation")) return "automation";
  return "form";
}

/**
 * Generate a human-readable summary of what products are needed.
 */
export function describeProductPlan(products: ProductType[], capabilities: Array<{ product: ProductType; capability: string }>): string {
  const parts: string[] = [];
  for (const product of products) {
    const def = getProduct(product);
    if (!def) continue;
    const caps = capabilities.filter((c) => c.product === product).map((c) => c.capability);
    if (caps.length) {
      parts.push(`${def.name}: ${caps.join(", ")}`);
    } else {
      parts.push(def.name);
    }
  }
  return parts.join(" + ");
}
