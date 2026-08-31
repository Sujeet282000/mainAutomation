// =============================================================================
// Universal Query Handler — LLM-powered router that handles ANY type of query.
//
// This module classifies user intent into categories beyond just workflows:
//   1. Workflow building/modification (existing path)
//   2. General knowledge questions (automation, integrations, best practices)
//   3. Data analysis / insight requests
//   4. Code generation (formulas, scripts, expressions)
//   5. System design / architecture consultation
//   6. Debugging / troubleshooting
//   7. Compound queries (multi-part requests)
//   8. Creative / content generation
//
// Each category has its own system prompt and response strategy, with
// graceful fallbacks when the LLM is unavailable.
// =============================================================================

import { completeAi } from "../ai-runtime";
import type { WorkflowGraph } from "@algoverge/shared";

// ── Query Categories ────────────────────────────────────────────────────────

export type QueryCategory =
  | "workflow_build"     // Build or modify a workflow
  | "workflow_explain"   // Explain current workflow
  | "workflow_debug"     // Debug/test/fix workflow
  | "general_knowledge"  // General automation/integration questions
  | "code_generation"    // Generate code, formulas, scripts
  | "data_analysis"      // Analyze data patterns
  | "system_design"      // Architecture / design consultation
  | "content_creation"   // Generate messages, templates, descriptions
  | "platform_help"      // Platform-specific how-to questions
  | "compound"           // Multi-part request
  | "conversational"     // Greetings, thanks, chit-chat
  | "unknown";           // Could not classify

export interface ClassifiedQuery {
  category: QueryCategory;
  confidence: number;
  subIntent?: string;          // More specific classification within category
  entities: string[];           // Named entities detected (apps, fields, concepts)
  requiresWorkflow: boolean;   // Whether this needs the current workflow graph
  requiresTools: boolean;      // Whether this needs tool execution
  compoundParts?: Array<{ prompt: string; category: QueryCategory }>;
  reasoning?: string;          // Why this classification was chosen
}

export interface QueryResponse {
  reply: string;
  category: QueryCategory;
  source: string;
  /** Optional workflow modifications to apply */
  graph?: WorkflowGraph;
  /** Tool calls the agent should execute */
  toolCalls?: Array<{ tool: string; input: Record<string, unknown> }>;
  /** Suggestions for follow-up actions */
  suggestions?: Array<{ label: string; prompt: string }>;
  /** Whether the response includes reasoning/thinking */
  thinking?: string;
}

// ── Classification Patterns (fast deterministic path) ───────────────────────

const CATEGORY_PATTERNS: Array<{
  category: QueryCategory;
  patterns: RegExp[];
  requiresWorkflow: boolean;
  requiresTools: boolean;
}> = [
  {
    category: "workflow_build",
    patterns: [
      /\b(create|build|make|generate|set up|design|add)\b.*\b(workflow|automation|zap|flow|pipeline|trigger|action)\b/i,
      /\b(when|whenever|if .+ then|trigger|every|schedule)\b.*\b(send|save|add|create|notify|post|email|slack|sheet)\b/i,
      /\b(send|save|add|create|notify|post)\b.*\b(to|via|through|using)\b.*\b(slack|email|sheet|gmail|notion|hubspot)\b/i,
    ],
    requiresWorkflow: true,
    requiresTools: false,
  },
  {
    category: "workflow_explain",
    patterns: [
      /\b(explain|describe|what does|how does|tell me about|walk me through|break down)\b.*\b(workflow|automation|flow|step|trigger|action|this)\b/i,
      /\b(what|how|why)\b.*\b(this|the)\b.*\b(workflow|flow|automation|step|node|zap)\b/i,
    ],
    requiresWorkflow: true,
    requiresTools: false,
  },
  {
    category: "workflow_debug",
    patterns: [
      /\b(debug|troubleshoot|fix|repair|error|fail|broken|issue|problem|why did)\b.*\b(workflow|flow|step|trigger|automation|run)\b/i,
      /\b(test|validate|check|verify|inspect|diagnose)\b.*\b(workflow|flow|step|this|the)\b/i,
    ],
    requiresWorkflow: true,
    requiresTools: false,
  },
  {
    category: "code_generation",
    patterns: [
      /\b(write|generate|create|show)\b.*\b(code|script|formula|expression|regex|function)\b/i,
      /\b(javascript|typescript|python|sql|json|html|css)\b.*\b(code|script|for|to)\b/i,
      /\b(should look like|syntax for|how to write)\b/i,
    ],
    requiresWorkflow: false,
    requiresTools: false,
  },
  {
    category: "data_analysis",
    patterns: [
      /\b(analyze|analyse|insight|pattern|trend|statistic|metric|performance)\b/i,
      /\b(how many|how much|what percentage|average|count|total|sum)\b.*\b(last|this|recent|past)\b/i,
    ],
    requiresWorkflow: false,
    requiresTools: true,
  },
  {
    category: "system_design",
    patterns: [
      /\b(design|architect|plan|structure|organize)\b.*\b(system|solution|setup|architecture)\b/i,
      /\b(how should i|what's the best way to|recommend|suggest)\b.*\b(setup|structure|design|implement)\b/i,
    ],
    requiresWorkflow: true,
    requiresTools: false,
  },
  {
    category: "content_creation",
    patterns: [
      /\b(write|draft|compose|create)\b.*\b(email|message|template|notification|subject|body|content)\b/i,
      /\b(help me (write|draft|compose))\b/i,
    ],
    requiresWorkflow: false,
    requiresTools: false,
  },
  {
    category: "platform_help",
    patterns: [
      /\b(how do i|how to|can i|what's the way to|steps to)\b.*\b(connect|authenticate|set up|configure|deploy|publish|test|run|schedule)\b/i,
      /\b(is it possible to|does .+ support|do you have)\b/i,
    ],
    requiresWorkflow: false,
    requiresTools: false,
  },
  {
    category: "conversational",
    patterns: [
      /^(hi|hello|hey|howdy|good morning|good evening|what'?s up|yo|sup|hola)\b/i,
      /^(thanks|thank you|thx|ty|cheers|appreciate)\b/i,
      /^(bye|goodbye|see you|later|good night)\b/i,
    ],
    requiresWorkflow: false,
    requiresTools: false,
  },
];

// ── Compound query detection ────────────────────────────────────────────────

const COMPOUND_SEPARATORS = /\b(and also|also,?|additionally|plus|furthermore|one more thing|oh and|and then|besides|moreover)\b/i;

function detectCompound(prompt: string): Array<{ prompt: string; category: QueryCategory }> | null {
  const parts = prompt.split(COMPOUND_SEPARATORS).filter((p) => p.trim().length > 5);
  if (parts.length < 2) return null;

  const classified: Array<{ prompt: string; category: QueryCategory }> = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (/^(and also|also,?|additionally|plus|furthermore|one more thing|oh and|and then|besides|moreover)$/i.test(trimmed)) continue;
    const cat = classifyByPatterns(trimmed);
    classified.push({ prompt: trimmed, category: cat.category });
  }

  // Only return compound if we have 2+ distinct meaningful parts
  return classified.length >= 2 ? classified : null;
}

// ── Core Classification ─────────────────────────────────────────────────────

function classifyByPatterns(prompt: string): {
  category: QueryCategory;
  confidence: number;
  requiresWorkflow: boolean;
  requiresTools: boolean;
} {
  const trimmed = prompt.trim();

  // Check conversational first
  if (/^(hi|hello|hey|howdy|thanks|thank you|thx|ty|bye|goodbye)[\s!.?]*$/i.test(trimmed)) {
    return { category: "conversational", confidence: 0.95, requiresWorkflow: false, requiresTools: false };
  }

  // Pattern-based matching
  let bestMatch: { category: QueryCategory; confidence: number; requiresWorkflow: boolean; requiresTools: boolean } | null = null;
  let bestPriority = -1;

  // Priority order: workflow_build > workflow_debug > workflow_explain > specific categories > general
  const priorityOrder: QueryCategory[] = [
    "workflow_build", "workflow_debug", "workflow_explain",
    "code_generation", "data_analysis", "system_design",
    "content_creation", "platform_help", "general_knowledge",
  ];

  for (const def of CATEGORY_PATTERNS) {
    let matchCount = 0;
    for (const pat of def.patterns) {
      if (pat.test(trimmed)) matchCount++;
    }
    if (matchCount > 0) {
      const priority = priorityOrder.indexOf(def.category);
      const confidence = Math.min(0.95, 0.6 + matchCount * 0.15);
      if (!bestMatch || priority > bestPriority || (priority === bestPriority && confidence > bestMatch.confidence)) {
        bestMatch = {
          category: def.category,
          confidence,
          requiresWorkflow: def.requiresWorkflow,
          requiresTools: def.requiresTools,
        };
        bestPriority = priority;
      }
    }
  }

  if (bestMatch) return bestMatch;

  // Default: general knowledge question (most questions are informational)
  return { category: "general_knowledge", confidence: 0.5, requiresWorkflow: false, requiresTools: false };
}

/**
 * Classify a user query into a category.
 * Uses fast deterministic patterns first, then LLM for ambiguous cases.
 */
export async function classifyQuery(
  prompt: string,
  graph?: WorkflowGraph | null,
): Promise<ClassifiedQuery> {
  const trimmed = prompt.trim();

  // Fast path: deterministic pattern matching
  const patternResult = classifyByPatterns(trimmed);

  // High-confidence pattern match — skip LLM classification
  if (patternResult.confidence >= 0.8) {
    // Still check for compound queries
    const compoundParts = detectCompound(trimmed);
    if (compoundParts) {
      return {
        category: "compound",
        confidence: 0.85,
        compoundParts,
        entities: extractEntities(trimmed),
        requiresWorkflow: compoundParts.some((p) => p.category === "workflow_build" || p.category === "workflow_explain"),
        requiresTools: compoundParts.some((p) => p.category === "data_analysis"),
      };
    }

    return {
      category: patternResult.category,
      confidence: patternResult.confidence,
      entities: extractEntities(trimmed),
      requiresWorkflow: patternResult.requiresWorkflow,
      requiresTools: patternResult.requiresTools,
    };
  }

  // Medium-confidence: check if it looks like a question
  const isQuestion = trimmed.includes("?") || /^(what|how|why|where|when|who|which|can|could|should|would|is|are|do|does|will|please)\b/i.test(trimmed);
  if (isQuestion && patternResult.confidence < 0.6) {
    // Route questions to general knowledge by default
    return {
      category: "general_knowledge",
      confidence: 0.65,
      entities: extractEntities(trimmed),
      requiresWorkflow: Boolean(graph?.nodes?.length),
      requiresTools: false,
    };
  }

  // Low confidence: try LLM classification
  try {
    const llmClassified = await classifyWithLlm(trimmed, graph);
    if (llmClassified) return llmClassified;
  } catch {
    /* LLM unavailable — use pattern result */
  }

  // Fallback to pattern result
  return {
    category: patternResult.category,
    confidence: patternResult.confidence,
    entities: extractEntities(trimmed),
    requiresWorkflow: patternResult.requiresWorkflow,
    requiresTools: patternResult.requiresTools,
  };
}

// ── LLM Classification ──────────────────────────────────────────────────────

async function classifyWithLlm(
  prompt: string,
  graph?: WorkflowGraph | null,
): Promise<ClassifiedQuery | null> {
  const workflowContext = graph?.nodes?.length
    ? `Current workflow: ${graph.nodes.map((n) => n.label || n.appSlug).join(" → ")}`
    : "No workflow loaded.";

  const result = await completeAi({
    intent: "classify",
    json: true,
    prompt: JSON.stringify({ userQuery: prompt, workflowContext }),
    system: [
      "Classify the user query into exactly ONE category.",
      "Categories: workflow_build, workflow_explain, workflow_debug, general_knowledge, code_generation, data_analysis, system_design, content_creation, platform_help, compound, conversational.",
      "Return JSON: { category, confidence (0-1), subIntent (optional), entities (string[]), requiresWorkflow (bool), requiresTools (bool), reasoning (optional) }.",
      "Use compound when the query has 2+ distinct requests joined by 'and', 'also', etc.",
      "Use conversational for greetings, thanks, and small talk.",
      "When unsure between workflow_build and general_knowledge, prefer general_knowledge.",
    ].join(" "),
  });

  if (!result.text) return null;

  try {
    const parsed = JSON.parse(result.text);
    if (parsed.category && typeof parsed.confidence === "number") {
      return {
        category: parsed.category,
        confidence: Math.min(1, Math.max(0, parsed.confidence)),
        subIntent: parsed.subIntent,
        entities: Array.isArray(parsed.entities) ? parsed.entities : extractEntities(prompt),
        requiresWorkflow: Boolean(parsed.requiresWorkflow),
        requiresTools: Boolean(parsed.requiresTools),
        compoundParts: parsed.compoundParts,
        reasoning: parsed.reasoning,
      };
    }
  } catch {
    /* JSON parse failed */
  }
  return null;
}

// ── Entity Extraction ───────────────────────────────────────────────────────

const APP_ENTITIES: Array<{ re: RegExp; name: string }> = [
  { re: /\bgmail\b/i, name: "Gmail" },
  { re: /\bgoogle sheets?\b/i, name: "Google Sheets" },
  { re: /\bgoogle calendar\b/i, name: "Google Calendar" },
  { re: /\bslack\b/i, name: "Slack" },
  { re: /\bhubspot\b/i, name: "HubSpot" },
  { re: /\bsalesforce\b/i, name: "Salesforce" },
  { re: /\bnotion\b/i, name: "Notion" },
  { re: /\bgithub\b/i, name: "GitHub" },
  { re: /\bjira\b/i, name: "Jira" },
  { re: /\blinear\b/i, name: "Linear" },
  { re: /\bstripe\b/i, name: "Stripe" },
  { re: /\bdiscord\b/i, name: "Discord" },
  { re: /\btelegram\b/i, name: "Telegram" },
  { re: /\bwhatsapp\b/i, name: "WhatsApp" },
  { re: /\bairtable\b/i, name: "Airtable" },
  { re: /\bopenai\b/i, name: "OpenAI" },
  { re: /\bclaude\b|\banthropic\b/i, name: "Claude" },
  { re: /\bgemini\b/i, name: "Gemini" },
  { re: /\bshopify\b/i, name: "Shopify" },
  { re: /\btrello\b/i, name: "Trello" },
  { re: /\basana\b/i, name: "Asana" },
  { re: /\bzendesk\b/i, name: "Zendesk" },
];

function extractEntities(prompt: string): string[] {
  const entities: string[] = [];
  for (const { re, name } of APP_ENTITIES) {
    if (re.test(prompt)) entities.push(name);
  }
  // Extract field-like entities
  if (/\b(email|e-mail)\b/i.test(prompt)) entities.push("email");
  if (/\b(subject)\b/i.test(prompt)) entities.push("subject");
  if (/\b(webhook|hook)\b/i.test(prompt)) entities.push("webhook");
  if (/\b(schedule|cron|daily|weekly|hourly)\b/i.test(prompt)) entities.push("schedule");
  return [...new Set(entities)];
}

// ── Response Generation ─────────────────────────────────────────────────────

/**
 * Generate a response for general knowledge queries using the LLM.
 * This is the "answer anything" capability — the copilot becomes a
 * knowledgeable assistant, not just a workflow builder.
 */
export async function respondToGeneralKnowledge(
  prompt: string,
  graph?: WorkflowGraph | null,
  history?: Array<{ role: "user" | "assistant"; content: string; ts?: string }>,
): Promise<QueryResponse> {
  const catalogSummary = getCatalogSummary();
  const workflowContext = graph?.nodes?.length
    ? `Current workflow: ${graph.nodes.map((n) => `${n.label ?? n.appSlug} (${n.appSlug}/${n.operation})`).join(" → ")}`
    : "No workflow loaded.";

  const historyBlock = history?.length
    ? "\n\nConversation so far:\n" + history.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n")
    : "";

  const system = [
    "You are an expert AI automation assistant embedded in a workflow builder platform.",
    "You can answer ANY question the user has — not just workflow-related ones.",
    "Topics you excel at:",
    "• Automation and workflow design best practices",
    "• Integration setup and configuration (Gmail, Slack, Sheets, etc.)",
    "• Data transformation, field mapping, and conditional logic",
    "• Code snippets (JavaScript, Python, SQL, regex) for automation steps",
    "• Platform features and capabilities",
    "• General technical knowledge (APIs, webhooks, OAuth, etc.)",
    "• Business process design and optimization",
    "• Troubleshooting and debugging automations",
    "",
    "Response guidelines:",
    "• Be concise and actionable (2-4 paragraphs max)",
    "• Use markdown for readability (headers, lists, code blocks)",
    "• If relevant to their workflow, reference their current automation",
    "• End with a clear next step or actionable suggestion when appropriate",
    "• If the question implies a workflow action, suggest the exact prompt they could use",
    "• Never expose internal reasoning or chain-of-thought",
  ].join("\n");

  const userMessage = [
    `Platform integrations:\n${catalogSummary}`,
    `\nWorkflow context:\n${workflowContext}`,
    historyBlock,
    `\nUser question: ${prompt}`,
  ].filter(Boolean).join("\n");

  const result = await completeAi({
    intent: "reason",
    prompt: userMessage,
    system,
    piiFilter: false,
  });

  const reply = result.text || "I'm not sure how to help with that. Could you rephrase your question?";

  // Generate contextual suggestions based on the query
  const suggestions = generateKnowledgeSuggestions(prompt, graph);

  return {
    reply,
    category: "general_knowledge",
    source: "universal-llm",
    suggestions,
  };
}

/**
 * Generate a response for code generation queries.
 */
export async function respondToCodeGeneration(
  prompt: string,
): Promise<QueryResponse> {
  const system = [
    "You are an expert programmer helping users write code for their automation workflows.",
    "Provide clean, working code with clear explanations.",
    "Always wrap code in appropriate markdown code blocks with language tags.",
    "Include brief explanations of what the code does.",
    "If the code is for use in a specific platform step (e.g., a Code step in the workflow), note that.",
    "Keep responses focused and practical.",
  ].join("\n");

  const result = await completeAi({
    intent: "generate",
    prompt,
    system,
    piiFilter: false,
  });

  return {
    reply: result.text || "I couldn't generate code for that. Could you provide more details?",
    category: "code_generation",
    source: "universal-llm-code",
  };
}

/**
 * Generate a response for content creation queries.
 */
export async function respondToContentCreation(
  prompt: string,
  graph?: WorkflowGraph | null,
): Promise<QueryResponse> {
  const workflowContext = graph?.nodes?.length
    ? `Current workflow: ${graph.nodes.map((n) => n.label || n.appSlug).join(" → ")}`
    : "";

  const system = [
    "You are a professional copywriter and content creator helping users craft messages for their automations.",
    "Write clear, professional, and engaging content.",
    "Match the tone to the context (formal for business emails, friendly for notifications, etc.).",
    "If the content is for an automation step, make it templatable with placeholder variables like {{name}}, {{email}}, {{date}}.",
    "Keep the output concise and ready to use.",
  ].join("\n");

  const result = await completeAi({
    intent: "generate",
    prompt: `${workflowContext ? `Workflow context: ${workflowContext}\n\n` : ""}User request: ${prompt}`,
    system,
    piiFilter: false,
  });

  return {
    reply: result.text || "I couldn't generate that content. Could you provide more details?",
    category: "content_creation",
    source: "universal-llm-content",
  };
}

/**
 * Generate a response for platform help queries.
 */
export async function respondToPlatformHelp(
  prompt: string,
): Promise<QueryResponse> {
  const catalogSummary = getCatalogSummary();

  const system = [
    "You are a helpful platform support assistant for a workflow automation builder.",
    "Answer questions about how to use the platform, connect apps, configure steps, and troubleshoot issues.",
    "Be specific and actionable — give step-by-step instructions when possible.",
    "Reference specific integrations and their capabilities when relevant.",
    "If the user needs to do something that requires a workflow action (like 'connect Slack'), suggest the exact prompt.",
  ].join("\n");

  const result = await completeAi({
    intent: "reason",
    prompt: `Available integrations:\n${catalogSummary}\n\nUser question: ${prompt}`,
    system,
    piiFilter: false,
  });

  return {
    reply: result.text || "I'm not sure about that. Try asking about a specific integration or feature.",
    category: "platform_help",
    source: "universal-llm-help",
  };
}

/**
 * Generate a response for compound queries by handling each part.
 */
export async function respondToCompound(
  parts: Array<{ prompt: string; category: QueryCategory }>,
  graph?: WorkflowGraph | null,
  history?: Array<{ role: "user" | "assistant"; content: string; ts?: string }>,
): Promise<QueryResponse> {
  const responses: string[] = [];

  for (const part of parts) {
    let response: QueryResponse;
    switch (part.category) {
      case "workflow_build":
      case "workflow_explain":
      case "workflow_debug":
        // Delegate to the existing workflow pipeline (handled by copilot.ts)
        responses.push(`**For "${part.prompt}":** I'll handle this as a workflow action — please ask this as a separate request after I respond to the other parts.`);
        break;
      case "code_generation":
        response = await respondToCodeGeneration(part.prompt);
        responses.push(`**For "${part.prompt.slice(0, 80)}...":**\n\n${response.reply}`);
        break;
      case "content_creation":
        response = await respondToContentCreation(part.prompt, graph);
        responses.push(`**For "${part.prompt.slice(0, 80)}...":**\n\n${response.reply}`);
        break;
      default:
        response = await respondToGeneralKnowledge(part.prompt, graph, history);
        responses.push(`**For "${part.prompt.slice(0, 80)}...":**\n\n${response.reply}`);
        break;
    }
  }

  return {
    reply: responses.join("\n\n---\n\n"),
    category: "compound",
    source: "universal-llm-compound",
    suggestions: [
      { label: "Build workflow", prompt: "Create a workflow" },
      { label: "Ask another question", prompt: "I have another question" },
    ],
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getCatalogSummary(): string {
  // Lazy import to avoid circular dependencies
  try {
    const { APP_CATALOG } = require("../catalog/catalog");
    return APP_CATALOG.slice(0, 40)
      .map((a: { name: string; slug: string; operations: Array<{ key: string }> }) =>
        `${a.name} (${a.slug}): ${a.operations.map((o: { key: string }) => o.key).join(", ")}`
      )
      .join("\n");
  } catch {
    return "Integration catalog not available.";
  }
}

function generateKnowledgeSuggestions(
  prompt: string,
  graph?: WorkflowGraph | null,
): Array<{ label: string; prompt: string }> {
  const lower = prompt.toLowerCase();
  const suggestions: Array<{ label: string; prompt: string }> = [];

  if (/webhook|http|api/i.test(lower)) {
    suggestions.push({ label: "Build webhook workflow", prompt: "Create a webhook workflow" });
  }
  if (/email|gmail|notification/i.test(lower)) {
    suggestions.push({ label: "Set up email notifications", prompt: "Set up email notifications" });
  }
  if (/slack|chat|message/i.test(lower)) {
    suggestions.push({ label: "Integrate with Slack", prompt: "Send notifications to Slack" });
  }
  if (/sheet|spreadsheet|data|table/i.test(lower)) {
    suggestions.push({ label: "Create data pipeline", prompt: "Create a data pipeline" });
  }
  if (/ai|llm|gpt|openai|claude|summarize|classify/i.test(lower)) {
    suggestions.push({ label: "Add AI processing step", prompt: "Add an AI processing step" });
  }

  if (!graph?.nodes?.length) {
    suggestions.push({ label: "Build a workflow", prompt: "Create a new workflow" });
  }

  return suggestions.slice(0, 4);
}
