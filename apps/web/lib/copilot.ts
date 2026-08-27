import { api, streamSse } from "./api";

export async function getCopilotStatus() {
  return api<{
    ok: boolean;
    plane: string;
    reachable: boolean;
    mode: string;
    openaiConfigured: boolean;
    anthropicConfigured: boolean;
    hint: string;
  }>("/copilot/status");
}

export type CopilotDraft = {
  sessionId: string;
  graph?: unknown;
  summary?: string;
  applied?: boolean;
  rebuilt?: boolean;
  changed?: boolean;
  source?: string;
};

export async function createCopilotSession(opts: {
  prompt: string;
  flowId?: string;
  mode?: string;
}) {
  return api<{ sessionId: string; projectId: string }>("/copilot/sessions", {
    method: "POST",
    body: JSON.stringify({
      prompt: opts.prompt,
      flowId: opts.flowId,
      mode: opts.mode === "ask_as_you_build" ? "ask_as_you_build" : "auto_build",
    }),
  });
}

function applyEvent(out: CopilotDraft, ev: Record<string, unknown>) {
  if (ev.type !== "proposal" && ev.type !== "result") return;
  if (ev.graph) out.graph = ev.graph;
  if (ev.summary) out.summary = String(ev.summary);
  if ("applied" in ev) out.applied = Boolean(ev.applied);
  if ("rebuilt" in ev) out.rebuilt = Boolean(ev.rebuilt);
  if ("changed" in ev) out.changed = Boolean(ev.changed);
  if (ev.source) out.source = String(ev.source);
}

export async function generateCopilotDraft(
  opts: {
    prompt: string;
    flowId?: string;
    mode?: string;
    graph?: unknown;
    selectedStepId?: string;
  },
  onEvent?: (ev: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<CopilotDraft> {
  const session = await createCopilotSession({
    prompt: opts.prompt,
    flowId: opts.flowId,
    mode: opts.mode,
  });
  const out: CopilotDraft = { sessionId: session.sessionId };
  await streamSse(
    `/copilot/sessions/${session.sessionId}/generate`,
    {
      prompt: opts.prompt,
      flowId: opts.flowId,
      mode: opts.mode,
      graph: opts.graph,
      selectedStepId: opts.selectedStepId,
    },
    (ev) => {
      applyEvent(out, ev);
      onEvent?.(ev);
    },
    signal,
  );
  return out;
}

export async function persistCopilotSession(sessionId: string, flowId: string) {
  return api<{ ok: boolean; flowId: string }>(`/copilot/sessions/${sessionId}/persist`, {
    method: "POST",
    body: JSON.stringify({ flowId }),
  });
}

export async function refineCopilotSession(
  sessionId: string,
  opts: {
    prompt: string;
    graph?: unknown;
    mode?: string;
    selectedStepId?: string;
    flowId?: string;
  },
) {
  return api<{
    reply: string;
    graph?: unknown;
    applied?: boolean;
    summary?: string;
    youDoFirst?: string[];
    iCan?: string[];
    events?: Array<{ type: string; stage?: string; label?: string; text?: string; kind?: string; message?: string }>;
  }>(`/copilot/sessions/${sessionId}/refine`, {
    method: "POST",
    body: JSON.stringify({
      prompt: opts.prompt,
      request_text: opts.prompt,
      graph: opts.graph,
      mode: opts.mode,
      selectedStepId: opts.selectedStepId,
      flowId: opts.flowId,
    }),
  });
}
