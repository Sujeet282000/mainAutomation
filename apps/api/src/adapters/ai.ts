import { completeAi, screenOutput } from "../ai-runtime";
import { isOpenAiApiKey, looksLikeSlackToken } from "../auth-schema";
import { env } from "../config";
import { requireOk } from "./http";
import { registerAdapter } from "./registry";

function resolveOpenaiKey(auth: Record<string, unknown> | null | undefined) {
  const stored = String(auth?.api_key ?? "").trim();
  const fromEnv = String(env.openai ?? "").trim();
  if (isOpenAiApiKey(stored)) return stored;
  if (isOpenAiApiKey(fromEnv)) return fromEnv;
  if (looksLikeSlackToken(stored) || looksLikeSlackToken(fromEnv)) {
    throw new Error(
      "OpenAI received a Slack token (xoxe/xoxb). Reconnect the OpenAI account with a key that starts with sk- from https://platform.openai.com/api-keys. Updating .env does not replace a saved connection unless OPENAI_API_KEY is a valid sk- key and the saved key is invalid."
    );
  }
  if (!stored && !fromEnv) throw new Error("OpenAI API key missing on connection or OPENAI_API_KEY.");
  throw new Error("OpenAI API key is not valid. Keys start with sk-. Reconnect the OpenAI step or set OPENAI_API_KEY.");
}

export async function testOpenAiConnection(auth: Record<string, unknown> | null) {
  const key = resolveOpenaiKey(auth);
  const res = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } });
  await requireOk(res, "OpenAI");
}

registerAdapter("openai", "complete", async ({ input, auth }) => {
  const key = resolveOpenaiKey(auth);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: input.model ?? "gpt-4o-mini",
      messages: [{ role: "user", content: String(input.prompt) }],
      response_format: input.json ? { type: "json_object" } : undefined
    })
  });
  const body = await requireOk(res, "OpenAI");
  const text = ((body.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content) ?? "";
  return { output: { text, raw: body } };
});

registerAdapter("anthropic", "complete", async ({ input, auth }) => {
  const key = String(auth?.api_key ?? env.anthropic);
  if (!key) throw new Error("Anthropic API key missing on connection or ANTHROPIC_API_KEY (MANUAL).");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: input.model ?? "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: [{ role: "user", content: String(input.prompt) }]
    })
  });
  const body = await requireOk(res, "Anthropic");
  const text = ((body.content as { text?: string }[] | undefined)?.[0]?.text) ?? "";
  return { output: { text, raw: body } };
});

registerAdapter("gemini", "complete", async ({ input, auth }) => {
  const key = String(auth?.api_key ?? env.gemini);
  if (!key) throw new Error("Gemini API key missing on connection or GEMINI_API_KEY (MANUAL).");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: String(input.prompt) }] }] })
    }
  );
  const body = await requireOk(res, "Gemini");
  const text = ((body.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined)?.[0]?.content?.parts?.[0]?.text) ?? "";
  return { output: { text, raw: body } };
});

async function openaiPrompt(auth: Record<string, unknown> | null, prompt: string, json = false) {
  const key = resolveOpenaiKey(auth);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: json ? { type: "json_object" } : undefined
    })
  });
  const body = await requireOk(res, "OpenAI");
  const text = ((body.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content) ?? "";
  return { output: { text, raw: body } };
}

registerAdapter("openai", "extract", async ({ input, auth }) =>
  openaiPrompt(auth, `Extract these fields as JSON.\nFields: ${input.schema}\n\nText:\n${input.text}`, true)
);
registerAdapter("openai", "summarize", async ({ input, auth }) => openaiPrompt(auth, `Summarize clearly:\n${input.text}`));
registerAdapter("openai", "classify", async ({ input, auth }) =>
  openaiPrompt(auth, `Classify using one of: ${input.labels}\n\n${input.text}`)
);
registerAdapter("openai", "write", async ({ input, auth }) =>
  openaiPrompt(auth, `Write this. Tone: ${input.tone ?? "professional"}.\n${input.prompt}`)
);
registerAdapter("openai", "translate", async ({ input, auth }) =>
  openaiPrompt(auth, `Translate to ${input.targetLanguage}:\n${input.text}`)
);
registerAdapter("openai", "analyze", async ({ input, auth }) =>
  openaiPrompt(auth, `Analyze sentiment, topics, and next actions as JSON.\n${input.text}`, true)
);
registerAdapter("openai", "transcribe", async ({ input }) => ({
  output: { text: "", note: "Upload audio in production Whisper. Received URL.", audioUrl: input.audioUrl }
}));
registerAdapter("openai", "search", async ({ input, auth }) =>
  openaiPrompt(auth, `Answer using only this context.\nContext:\n${input.context ?? ""}\n\nQuestion: ${input.query}`)
);

registerAdapter("agents", "run", async ({ input, auth }) => {
  const planned = await completeAi({
    intent: "reason",
    prompt: `Instructions:\n${input.instructions ?? ""}\n\nInput:\n${JSON.stringify(input.input ?? input.message ?? "")}`,
    system: "You are a workspace agent. Reply with the next action in plain language. Do not claim you called an API unless the payload already includes a tool result."
  });
  const screened = screenOutput(planned.text);
  if (!screened.allowed) throw new Error("Agent output blocked by guardrails.");
  return { output: { reply: screened.text || planned.text, source: planned.source } };
});
registerAdapter("chatbots", "message", async ({ input, auth }) => {
  const planned = await completeAi({
    intent: "complete",
    prompt: String(input.message ?? ""),
    system: String(input.instructions ?? "You are a workspace chatbot. Answer from the provided knowledge only when possible.") + `\nKnowledge:\n${input.knowledge ?? ""}`
  });
  return { output: { reply: planned.text || "I could not generate a reply.", source: planned.source } };
});
registerAdapter("ai", "summarize", async ({ input, auth }) =>
  openaiPrompt(auth, `Summarize clearly:\n${input.text}`)
);
registerAdapter("ai", "classify", async ({ input, auth }) =>
  openaiPrompt(auth, `Classify using one of: ${input.labels}\n\n${input.text}`)
);
registerAdapter("ai", "extract", async ({ input, auth }) =>
  openaiPrompt(auth, `Extract these fields as JSON.\nFields: ${input.schema}\n\nText:\n${input.text}`, true)
);
registerAdapter("ai", "draft", async ({ input, auth }) =>
  openaiPrompt(auth, `Write this. Tone: ${input.tone ?? "professional"}.\n${input.prompt}`)
);
registerAdapter("ai", "complete", async ({ input, auth }) => openaiPrompt(auth, String(input.prompt)));
