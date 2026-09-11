import { env } from "./config";
import { chatWithTools, parseModelRoute } from "./agent/model-router";

export type AiIntent = "generate" | "classify" | "extract" | "complete" | "reason";

export type AiMessage = { role: "system" | "user" | "assistant"; content: string };

export function redactPii(text: string) {
  return text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[ssn]")
    .replace(/\b(?:\d[ -]*?){13,16}\b/g, "[card]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]");
}

export function screenOutput(text: string, policy = "") {
  const blocked = /\b(ssn|credit card|password|secret key)\b/i.test(text) || /ignore previous instructions/i.test(text);
  if (blocked) return { allowed: false as const, reason: "policy", text: "" };
  if (policy && /block:/i.test(policy)) {
    const term = policy.split(/block:/i)[1]?.trim().split(/\s+/)[0];
    if (term && text.toLowerCase().includes(term.toLowerCase())) {
      return { allowed: false as const, reason: "policy_term", text: "" };
    }
  }
  return { allowed: true as const, text };
}

export function aiUnavailableMessage() {
  return "AI is temporarily unavailable — all model providers failed (OpenAI, Anthropic, Gemini, Groq, local LLM). Check your API keys and billing, then try again in a moment.";
}

async function callAiService(path: string, body: Record<string, unknown>, orgId = "system") {
  const { signedAiJson } = await import("./ai-service");
  return signedAiJson(path, body, orgId);
}

/**
 * Single-provider text completion with automatic failover across every
 * configured provider (OpenAI → Anthropic → Gemini → Groq → local LLM).
 * Used by copilot helpers, chatbots, and the AI adapters.
 */
export async function completeAi(opts: {
  intent: AiIntent;
  prompt: string;
  system?: string;
  json?: boolean;
  piiFilter?: boolean;
}) {
  const prompt = opts.piiFilter === false ? opts.prompt : redactPii(opts.prompt);
  const system = opts.system ?? "You are the automation platform AI layer. Be concise and factual.";

  // 1) Python AI service (optional plane) first — it has its own prompts.
  const paths =
    opts.intent === "classify"
      ? ["/v1/classify", "/v1/complete"]
      : opts.intent === "extract"
        ? ["/v1/extract", "/v1/complete"]
        : opts.intent === "reason"
          ? ["/v1/agent-plan", "/v1/complete"]
          : ["/v1/complete"];
  for (const path of paths) {
    try {
      const hit = await callAiService(path, {
        prompt,
        system,
        json: opts.json ?? false,
        intent: opts.intent
      });
      const text = String(hit?.text ?? hit?.reply ?? hit?.content ?? "");
      if (text) return { text, source: "ai-service" as const };
    } catch {
      /* service optional */
    }
  }

  // 2) Multi-provider failover via the agent model router. chatWithTools
  //    already cascades OpenAI → Anthropic → Gemini → Groq → local and throws
  //    MODEL_PROVIDER_FAILED only when every provider fails.
  const text = await chatText({
    system,
    user: prompt,
    json: opts.json ?? false,
    maxTokens: opts.intent === "reason" ? 1500 : 800,
  });
  if (text) return { text, source: "failover" as const };

  return { text: "", source: "none" as const };
}

/** Plain text chat through the provider failover chain. Returns "" when all fail. */
export async function chatText(opts: {
  system?: string;
  user: string;
  history?: AiMessage[];
  json?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const messages = [
    ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
    ...(opts.history ?? []),
    { role: "user" as const, content: opts.user },
  ];
  try {
    const completion = await chatWithTools({
      route: parseModelRoute("auto"),
      messages: messages as never,
      tools: [],
    });
    let text = completion.text?.trim() ?? "";
    if (opts.json) {
      // Models sometimes wrap JSON in ```json fences or prose; extract it.
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) text = fence[1].trim();
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end > start) text = text.slice(start, end + 1);
    }
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("NO_MODEL_PROVIDER") || msg.startsWith("MODEL_PROVIDER_FAILED")) {
      console.error("[ai-runtime] all model providers failed:", msg.slice(0, 400));
    } else {
      console.error("[ai-runtime] chat failed:", msg.slice(0, 200));
    }
    return "";
  }
}
