import { env } from "../config";

// ── Provider-neutral message / tool-call types ──────────────────────────────

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Gemini 3 signs function calls; the signature must be echoed back on the
   *  next round or the API rejects the turn. Passed through provider-neutral. */
  thoughtSignature?: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** For role="assistant" messages that requested tool calls. */
  toolCalls?: ToolCallRequest[];
  /** For role="tool" messages: which call this result answers. */
  toolCallId?: string;
  /** Tool results should never flow back with secrets; keep it plain text. */
  name?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ChatCompletion {
  text: string;
  toolCalls: ToolCallRequest[];
  model: string;
  provider: string;
  finishReason: "stop" | "tool_calls" | "length" | "error" | "none";
  usage: { inputTokens: number; outputTokens: number };
}

// ── Router configuration ────────────────────────────────────────────────────

export type ProviderName = "openai" | "anthropic" | "gemini" | "groq" | "local";

export type AgentModelRoute =
  | { kind: "auto" }
  | { kind: "fixed"; provider: ProviderName; model: string };

/** Parse `provider:model` agent config like `openai:gpt-4o-mini` or `groq:openai/gpt-oss-120b`. */
export function parseModelRoute(model?: string | null): AgentModelRoute {
  const raw = String(model ?? "").trim();
  if (!raw || raw === "auto") return { kind: "auto" };
  const [provider, ...rest] = raw.split(":");
  const m = rest.join(":");
  if (
    (provider === "openai" || provider === "anthropic" || provider === "gemini" || provider === "groq" || provider === "local") &&
    m
  ) {
    return { kind: "fixed", provider, model: m };
  }
  // Unknown format: treat as a bare OpenAI-style model name.
  return { kind: "fixed", provider: "openai", model: raw };
}

const DEFAULTS: Record<ProviderName, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
  // gemini-2.0-flash was retired by Google and 2.5-flash is blocked for new
  // API keys; 3.6-flash is the current stable generation this key can use.
  gemini: "gemini-3.6-flash",
  // llama-3.3-70b-versatile was decommissioned by Groq; gpt-oss-120b is the
  // current flagship chat model with native tool-calling.
  groq: "openai/gpt-oss-120b",
  // qwen2.5:3b-instruct — small (1.9GB), CPU-friendly, and reliably emits
  // native OpenAI-style tool_calls through Ollama's /v1 endpoint.
  local: "qwen2.5:3b-instruct",
};

function providerReady(p: ProviderName): boolean {
  switch (p) {
    case "openai": return Boolean(env.openai) && /^sk-(?!ant)/.test(env.openai) && !/^xox/i.test(env.openai);
    // Accept Groq's gsk_ keys and OpenAI-compatible sk_ proxies alike.
    case "groq": return /^gsk_[A-Za-z0-9]{20,}/.test(env.groq) || /^sk_(?!ant)/.test(env.groq);
    case "anthropic": return env.anthropic.startsWith("sk-ant");
    case "gemini": return Boolean(env.gemini);
    case "local": return Boolean(env.localLlmUrl);
  }
}

/** Provider preference order for `auto` routing — first ready provider wins. */
const AUTO_ORDER: ProviderName[] = ["openai", "anthropic", "gemini", "groq", "local"];

export function routeProvider(route: AgentModelRoute): { provider: ProviderName; model: string } | null {
  if (route.kind === "fixed") {
    return providerReady(route.provider) ? { provider: route.provider, model: route.model } : null;
  }
  for (const p of AUTO_ORDER) {
    if (providerReady(p)) return { provider: p, model: DEFAULTS[p] };
  }
  return null;
}

// ── Provider adapters (all use fetch, no SDK dependency) ────────────────────

type NormalizedResponse = {
  text: string;
  toolCalls: ToolCallRequest[];
  finishReason: ChatCompletion["finishReason"];
  usage: { inputTokens: number; outputTokens: number };
};

function genId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

async function openaiChat(
  provider: ProviderName,
  model: string,
  messages: ChatMessage[],
  tools: ToolSchema[],
): Promise<NormalizedResponse> {
  const apiKey = env.openai;
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  // Map our neutral messages onto OpenAI's wire format.
  const wire: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      wire.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      wire.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      });
    } else {
      wire.push({ role: m.role, content: m.content });
    }
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: wire,
      tools: tools.length
        ? tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          }))
        : undefined,
      tool_choice: tools.length ? "auto" : undefined,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`OPENAI_HTTP_${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    choices?: Array<{
      message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = data.choices?.[0];
  const toolCalls: ToolCallRequest[] = (choice?.message?.tool_calls ?? []).flatMap((c) => {
    const name = c.function?.name ?? "";
    if (!name) return [];
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(c.function?.arguments ?? "{}") as unknown;
      if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
    } catch {
      /* model emitted non-JSON arguments; treat as empty */
    }
    return [{ id: c.id ?? genId("call"), name, arguments: args }];
  });
  return {
    text: choice?.message?.content ?? "",
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : choice?.finish_reason === "length" ? "length" : "stop",
    usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
  };
}

async function anthropicChat(
  model: string,
  messages: ChatMessage[],
  tools: ToolSchema[],
): Promise<NormalizedResponse> {
  const apiKey = env.anthropic;
  const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
  // Anthropic: system is a top-level param; tool results are user messages with tool_result blocks.
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const wire: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      wire.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
      });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      wire.push({
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...m.toolCalls.map((c) => ({
            type: "tool_use",
            id: c.id,
            name: c.name,
            input: c.arguments,
          })),
        ],
      });
    } else {
      wire.push({ role: m.role, content: m.content });
    }
  }
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: system || undefined,
      messages: wire,
      tools: tools.length
        ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
        : undefined,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`ANTHROPIC_HTTP_${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    stop_reason?: string;
  };
  const toolCalls: ToolCallRequest[] = (data.content ?? []).flatMap((b) =>
    b.type === "tool_use" && b.name
      ? [{ id: b.id ?? genId("call"), name: b.name, arguments: (b.input ?? {}) as Record<string, unknown> }]
      : [],
  );
  return {
    text: (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(""),
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : data.stop_reason === "max_tokens" ? "length" : "stop",
    usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
  };
}

/** Gemini's schema subset rejects OpenAI-only keywords like additionalProperties. */
function geminiSafeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "additionalProperties" || k === "$schema" || k === "$id") continue;
    if (Array.isArray(v)) {
      out[k] = v.map((item) => (item && typeof item === "object" ? geminiSafeSchema(item as Record<string, unknown>) : item));
    } else if (v && typeof v === "object") {
      out[k] = geminiSafeSchema(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function geminiChat(
  model: string,
  messages: ChatMessage[],
  tools: ToolSchema[],
): Promise<NormalizedResponse> {
  const apiKey = env.gemini;
  const baseUrl = (process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name: m.name ?? "tool", response: { result: m.content } } }],
      });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      contents.push({
        role: "model",
        parts: [
          ...(m.content ? [{ text: m.content }] : []),
          ...m.toolCalls.map((c) => ({
            functionCall: { name: c.name, args: c.arguments },
            ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}),
          })),
        ],
      });
    } else {
      contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
    }
  }
  const res = await fetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      tools: tools.length
        ? [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSafeSchema(t.inputSchema) })) }]
        : undefined,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`GEMINI_HTTP_${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thoughtSignature?: string; functionCall?: { id?: string; name?: string; args?: unknown } }> }; finishReason?: string }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const toolCalls: ToolCallRequest[] = parts.flatMap((p) =>
    p.functionCall?.name
      ? [{
          id: typeof p.functionCall.id === "string" && p.functionCall.id ? p.functionCall.id : genId("call"),
          name: p.functionCall.name,
          arguments: (p.functionCall.args ?? {}) as Record<string, unknown>,
          thoughtSignature: typeof p.thoughtSignature === "string" ? p.thoughtSignature : undefined,
        }]
      : [],
  );
  return {
    text: parts.filter((p) => typeof p.text === "string").map((p) => p.text).join(""),
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : data.candidates?.[0]?.finishReason === "MAX_TOKENS" ? "length" : "stop",
    usage: { inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0 },
  };
}

async function groqChat(
  model: string,
  messages: ChatMessage[],
  tools: ToolSchema[],
): Promise<NormalizedResponse> {
  // Groq exposes an OpenAI-compatible chat completions API with tool calling.
  const apiKey = env.groq;
  const baseUrl = (process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const wire: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      wire.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      wire.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      });
    } else {
      wire.push({ role: m.role, content: m.content });
    }
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: wire,
      tools: tools.length
        ? tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          }))
        : undefined,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`GROQ_HTTP_${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    choices?: Array<{
      message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const toolCalls: ToolCallRequest[] = (data.choices?.[0]?.message?.tool_calls ?? []).flatMap((c) => {
    const name = c.function?.name ?? "";
    if (!name) return [];
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(c.function?.arguments ?? "{}") as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    return [{ id: c.id ?? genId("call"), name, arguments: args }];
  });
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
    usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
  };
}

async function localChat(
  model: string,
  messages: ChatMessage[],
  tools: ToolSchema[],
): Promise<NormalizedResponse> {
  // OpenAI-compatible endpoint (Ollama, vLLM, LM Studio, LocalAI).
  const baseUrl = env.localLlmUrl.replace(/\/$/, "");
  const apiKey = process.env.LOCAL_LLM_API_KEY ?? "ollama";
  // Forward the full tool-calling transcript (assistant tool_calls and tool
  // results keyed by tool_call_id) — providers need both to associate turns.
  const wire: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      wire.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      wire.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      });
    } else {
      wire.push({ role: m.role, content: m.content });
    }
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: wire,
      tools: tools.length
        ? tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          }))
        : undefined,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`LOCAL_LLM_HTTP_${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>;
  };
  const toolCalls: ToolCallRequest[] = (data.choices?.[0]?.message?.tool_calls ?? []).flatMap((c) => {
    const name = c.function?.name ?? "";
    if (!name) return [];
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(c.function?.arguments ?? "{}") as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    return [{ id: c.id ?? genId("call"), name, arguments: args }];
  });
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

// ── Public entrypoint ───────────────────────────────────────────────────────

/**
 * One round-trip through the routed provider with native tool-calling.
 * On provider failure (out of credits, rate limit, outage) it fails over to
 * the next configured provider, preserving the caller's fallback semantics.
 */
export async function chatWithTools(opts: {
  route: AgentModelRoute;
  messages: ChatMessage[];
  tools: ToolSchema[];
}): Promise<ChatCompletion> {
  const candidates: Array<{ provider: ProviderName; model: string }> = [];
  const primary = routeProvider(opts.route);
  if (primary) candidates.push(primary);
  for (const p of AUTO_ORDER) {
    if (!candidates.some((c) => c.provider === p) && providerReady(p)) candidates.push({ provider: p, model: DEFAULTS[p] });
  }
  if (!candidates.length) {
    throw new Error(
      "NO_MODEL_PROVIDER: configure OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY or LOCAL_LLM_BASE_URL, or set the agent's model to provider:model.",
    );
  }
  const failures: string[] = [];
  for (const { provider, model } of candidates) {
    try {  const normalized =
    provider === "anthropic"
      ? await anthropicChat(model, opts.messages, opts.tools)
      : provider === "gemini"
        ? await geminiChat(model, opts.messages, opts.tools)
        : provider === "groq"
          ? await groqChat(model, opts.messages, opts.tools)
          : provider === "local"
            ? await localChat(model, opts.messages, opts.tools)
            : await openaiChat(provider, model, opts.messages, opts.tools);
      return { ...normalized, model, provider };
    } catch (error) {
      const failure = `${provider}:${error instanceof Error ? error.message.slice(0, 160) : "failed"}`;
      // Silent failover hides cost/latency regressions; always surface it.
      console.error(`[model-router] provider failed, failing over: ${failure}`);
      failures.push(failure);
    }
  }
  throw new Error(`MODEL_PROVIDER_FAILED: ${failures.join(" | ")}`);
}

