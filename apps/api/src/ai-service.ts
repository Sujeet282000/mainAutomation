import { env } from "./config";
import { createServiceToken, hashServiceBody } from "./auth";

export type AiPlaneStatus = {
  reachable: boolean;
  mode: "live" | "heuristic" | "down";
  openaiConfigured: boolean;
  anthropicConfigured: boolean;
  geminiConfigured: boolean;
  localConfigured: boolean;
  pythonProviders?: { openai?: boolean; anthropic?: boolean; gemini?: boolean; mode?: string };
  hint: string;
};

function compactJson(value: unknown) {
  return JSON.stringify(value);
}

export function providerHints() {
  const openai = Boolean(env.openai) && /^sk-(?!ant)/.test(env.openai) && !/^xox/i.test(env.openai);
  const anthropic = Boolean(env.anthropic) && (env.anthropic.startsWith("sk-ant") || env.anthropic.startsWith("sk-ant-"));
  const gemini = Boolean(env.gemini);
  const local = Boolean(env.localLlmUrl);
  return { openaiConfigured: openai, anthropicConfigured: anthropic, geminiConfigured: gemini, localConfigured: local };
}

export function signedAiHeaders(method: string, path: string, rawBody: string, orgId: string, requestId: string) {
  const token = createServiceToken({
    method,
    path,
    bodySha256: hashServiceBody(rawBody),
    orgId,
    requestId,
  });
  return {
    "content-type": "application/json",
    "x-orchestra-service-token": token,
  };
}

export async function probeAiService(): Promise<AiPlaneStatus> {
  const keys = providerHints();
  const base = env.aiServiceUrl.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) {
      return {
        reachable: false,
        mode: "down",
        ...keys,
        hint: `AI service at ${base} returned ${res.status}. Copilot will use the Node catalog engine.`,
      };
    }
    const data = (await res.json()) as {
      providers?: { openai?: boolean; anthropic?: boolean };
      mode?: string;
    };
    const live = data.mode === "live" || Boolean(data.providers?.openai || data.providers?.anthropic) || keys.openaiConfigured || keys.anthropicConfigured;
    return {
      reachable: true,
      mode: live ? "live" : "heuristic",
      ...keys,
      pythonProviders: { openai: data.providers?.openai, anthropic: data.providers?.anthropic, mode: data.mode },
      hint: live
        ? "AI plane is up. Copilot uses the Python model gateway."
        : "AI service is up but no live provider keys loaded — Copilot will plan with heuristics plus the catalog.",
    };
  } catch {
    return {
      reachable: false,
      mode: "down",
      ...keys,
      hint: `Cannot reach the AI service at ${base}. Start apps/ai on port 8000. Node Copilot engine remains available.`,
    };
  }
}

export async function signedAiJson<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
  orgId: string,
  timeoutMs = 25000,
): Promise<T | null> {
  const requestId = crypto.randomUUID();
  const payload = { ...body, org_id: orgId, request_id: requestId };
  const raw = compactJson(payload);
  const res = await fetch(`${env.aiServiceUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: signedAiHeaders("POST", path, raw, orgId, requestId),
    body: raw,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function* streamAiCopilotGenerate(opts: {
  sessionId: string;
  flowId: string;
  prompt: string;
  orgId: string;
  userEmail: string;
  projectId: string;
  autonomy: string;
  timezone?: string;
}): AsyncGenerator<Record<string, unknown>> {
  const requestId = crypto.randomUUID();
  const path = "/copilot/generate";
  const payload = {
    session_id: opts.sessionId,
    flow_id: opts.flowId,
    request_text: opts.prompt,
    user_email: opts.userEmail,
    project_id: opts.projectId,
    autonomy: opts.autonomy,
    timezone: opts.timezone ?? "UTC",
    org_id: opts.orgId,
    request_id: requestId,
  };
  const raw = compactJson(payload);
  const res = await fetch(`${env.aiServiceUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: signedAiHeaders("POST", path, raw, opts.orgId, requestId),
    body: raw,
    signal: AbortSignal.timeout(70000),
  });
  if (!res.ok || !res.body) {
    throw new Error(`AI_SERVICE_${res.status || "DOWN"}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + 60_000; // 60s total body-read budget
  while (true) {
    if (Date.now() > deadline) break;
    const readPromise = reader.read();
    const timeoutPromise = new Promise<never>((_, reject) => {
      const id = setTimeout(() => reject(new Error("STREAM_TIMEOUT")), 60_000);
      readPromise.then(() => clearTimeout(id), () => clearTimeout(id));
    });
    const { done, value } = await Promise.race([readPromise, timeoutPromise]);
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((row) => row.startsWith("data: "));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(6)) as Record<string, unknown>;
      } catch {
        /* ignore malformed */
      }
    }
  }
  if (buf.trim()) {
    const line = buf.split("\n").find((row) => row.startsWith("data: "));
    if (line) {
      try {
        yield JSON.parse(line.slice(6)) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
    }
  }
}
