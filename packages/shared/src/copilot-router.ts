// =============================================================================
// Copilot Product Router — Classifies user intent into the right asset type
// Routes: NL → Intent → Asset Type → Planner → Catalog → Build
// =============================================================================

import { z } from "zod";

// ─── Intent Classification ───────────────────────────────────────────────────

export const IntentClassification = z.object({
  // Primary intent
  assetType: z.enum([
    "workflow",
    "table",
    "form",
    "interface",
    "canvas",
    "agent",
    "chatbot",
    "system",      // Multi-asset system
    "modify",      // Modify existing asset
    "unknown",
  ]),
  confidence: z.number().min(0).max(1),
  // What the user wants to do
  action: z.enum([
    "create",
    "modify",
    "run",
    "test",
    "explain",
    "list",
  ]).default("create"),
  // Detected entities
  entities: z.object({
    apps: z.array(z.string()).default([]),
    tables: z.array(z.string()).default([]),
    workflows: z.array(z.string()).default([]),
    agents: z.array(z.string()).default([]),
    chatbots: z.array(z.string()).default([]),
    forms: z.array(z.string()).default([]),
    interfaces: z.array(z.string()).default([]),
  }).default({}),
  // Dependencies (assets that need to be created first)
  dependencies: z.array(z.object({
    assetType: z.string(),
    name: z.string(),
    reason: z.string(),
  })).default([]),
  // Missing info
  missingInfo: z.array(z.string()).default([]),
  // Suggestions
  suggestions: z.array(z.string()).default([]),
});
export type IntentClassification = z.infer<typeof IntentClassification>;

// ─── Product Router Rules ────────────────────────────────────────────────────

const ROUTE_RULES: Array<{
  patterns: RegExp[];
  assetType: IntentClassification["assetType"];
  dependencies?: Array<{ assetType: string; name: string; reason: string }>;
}> = [
  // Workflow
  {
    patterns: [
      /\b(when|whenever|if|then|automate|workflow|zap|flow|pipeline)\b/i,
      /\b(trigger|action|condition|loop|delay|webhook|cron|schedule)\b/i,
    ],
    assetType: "workflow",
  },
  // Table
  {
    patterns: [
      /\b(table|database|records?|rows?|fields?|spreadsheet|CRM|tracker)\b/i,
      /\b(create|make|build|set up)\b.*\b(table|database|tracker|CRM)\b/i,
    ],
    assetType: "table",
  },
  // Form
  {
    patterns: [
      /\b(form|survey|questionnaire|signup|registration|lead capture|contact form)\b/i,
      /\b(create|make|build|set up)\b.*\b(form|survey|questionnaire)\b/i,
    ],
    assetType: "form",
  },
  // Interface / Portal / Dashboard
  {
    patterns: [
      /\b(interface|portal|dashboard|page|app|UI|screen|view)\b/i,
      /\b(customer portal|employee portal|admin panel|dashboard)\b/i,
    ],
    assetType: "interface",
  },
  // Canvas / System diagram
  {
    patterns: [
      /\b(canvas|diagram|system|architecture|map|overview|visualize)\b/i,
      /\b(put.*on|show.*system|visualize.*flow|map out)\b/i,
    ],
    assetType: "canvas",
  },
  // Agent
  {
    patterns: [
      /\b(agent|autonomous|AI worker|bot|assistant|copilot)\b/i,
      /\b(analyze|research|monitor|watch|process automatically)\b/i,
    ],
    assetType: "agent",
  },
  // Chatbot
  {
    patterns: [
      /\b(chatbot|chat bot|conversational|chat interface|support bot|FAQ bot)\b/i,
      /\b(chat with|talk to|ask questions|customer support bot)\b/i,
    ],
    assetType: "chatbot",
  },
  // System (multi-asset)
  {
    patterns: [
      /\b(system|complete solution|full setup|end.to.end|entire)\b/i,
      /\b(customer support system|onboarding system|lead management|sales pipeline)\b/i,
    ],
    assetType: "system",
  },
];

/**
 * Classify user intent into an asset type.
 */
export function classifyIntent(prompt: string): IntentClassification {
  const lower = prompt.toLowerCase();

  // Score each asset type
  const scores: Array<{ assetType: IntentClassification["assetType"]; score: number; deps: Array<{ assetType: string; name: string; reason: string }> }> = [];

  for (const rule of ROUTE_RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(prompt)) score += 1;
    }
    if (score > 0) {
      scores.push({
        assetType: rule.assetType,
        score,
        deps: rule.dependencies ?? [],
      });
    }
  }

  // Sort by score
  scores.sort((a, b) => b.score - a.score);

  if (scores.length === 0) {
    return {
      assetType: "unknown",
      confidence: 0,
      action: "create",
      entities: { apps: [], tables: [], workflows: [], agents: [], chatbots: [], forms: [], interfaces: [] },
      dependencies: [],
      missingInfo: ["Could not determine what you want to create. Try being more specific."],
      suggestions: [
        "Create a workflow that...",
        "Create a table for...",
        "Create a form to collect...",
        "Create an agent that...",
      ],
    };
  }

  const best = scores[0];
  const confidence = Math.min(best.score / 2, 1);

  // Extract entity mentions
  const entities = extractEntities(prompt);

  return {
    assetType: best.assetType,
    confidence,
    action: "create",
    entities,
    dependencies: best.deps,
    missingInfo: [],
    suggestions: [],
  };
}

function extractEntities(prompt: string): IntentClassification["entities"] {
  const lower = prompt.toLowerCase();

  // App detection
  const appPatterns: Array<{ pattern: RegExp; slug: string }> = [
    { pattern: /gmail|email|inbox/i, slug: "gmail" },
    { pattern: /google sheet|spreadsheet/i, slug: "google-sheets" },
    { pattern: /slack/i, slug: "slack" },
    { pattern: /hubspot/i, slug: "hubspot" },
    { pattern: /salesforce/i, slug: "salesforce" },
    { pattern: /notion/i, slug: "notion" },
    { pattern: /airtable/i, slug: "airtable" },
    { pattern: /github/i, slug: "github" },
    { pattern: /discord/i, slug: "discord" },
    { pattern: /telegram/i, slug: "telegram" },
    { pattern: /whatsapp/i, slug: "whatsapp" },
    { pattern: /stripe/i, slug: "stripe" },
    { pattern: /twilio|sms/i, slug: "twilio" },
    { pattern: /jira/i, slug: "jira" },
    { pattern: /linear/i, slug: "linear" },
    { pattern: /zendesk/i, slug: "zendesk" },
    { pattern: /shopify/i, slug: "shopify" },
    { pattern: /calendly/i, slug: "calendly" },
    { pattern: /openai|chatgpt/i, slug: "openai" },
    { pattern: /typeform/i, slug: "typeform" },
  ];

  const apps = appPatterns
    .filter((p) => p.pattern.test(prompt))
    .map((p) => p.slug);

  return {
    apps,
    tables: [],
    workflows: [],
    agents: [],
    chatbots: [],
    forms: [],
    interfaces: [],
  };
}
