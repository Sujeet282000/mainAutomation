import { env } from "./config";

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

async function callAiService(path: string, body: Record<string, unknown>, orgId = "system") {
  const { signedAiJson } = await import("./ai-service");
  return signedAiJson(path, body, orgId);
}

async function openaiChat(messages: AiMessage[], jsonMode = false) {
  if (!env.openai) return "";
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.openai}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: jsonMode ? 0.1 : 0.2,
        response_format: jsonMode ? { type: "json_object" } : undefined,
        messages
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  } catch {
    return "";
  }
}

export async function completeAi(opts: {
  intent: AiIntent;
  prompt: string;
  system?: string;
  json?: boolean;
  piiFilter?: boolean;
}) {
  const prompt = opts.piiFilter === false ? opts.prompt : redactPii(opts.prompt);
  const system = opts.system ?? "You are the automation platform AI layer. Be concise and factual.";
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
  const text = await openaiChat(
    [
      { role: "system", content: system },
      { role: "user", content: prompt }
    ],
    opts.json
  );
  if (text) return { text, source: "openai" as const };
  return { text: "", source: "none" as const };
}
