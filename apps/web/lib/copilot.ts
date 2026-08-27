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
  operations?: CopilotOperation[];
  applied_operations?: CopilotOperation[];
  rejected_operations?: Array<{ operation: CopilotOperation; reason: string }>;
  needs_confirmation?: CopilotOperation[];
  needs_input?: string[];
  issues?: Array<{ code?: string; message: string; nodeId?: string }>;
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
  if (Array.isArray(ev.operations)) out.operations = ev.operations as CopilotOperation[];
  if (Array.isArray(ev.applied_operations)) out.applied_operations = ev.applied_operations as CopilotOperation[];
  if (Array.isArray(ev.rejected_operations)) out.rejected_operations = ev.rejected_operations as CopilotDraft['rejected_operations'];
  if (Array.isArray(ev.needs_confirmation)) out.needs_confirmation = ev.needs_confirmation as CopilotOperation[];
  if (Array.isArray(ev.needs_input)) out.needs_input = ev.needs_input as string[];
  if (Array.isArray(ev.issues)) out.issues = ev.issues as CopilotDraft['issues'];
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

export type CopilotOperation = {
  kind: string;
  arguments: Record<string, unknown>;
  requires_confirmation?: boolean;
};

export type CopilotRefineResult = {
  reply: string;
  graph?: unknown;
  applied?: boolean;
  changed?: boolean;
  summary?: string;
  youDoFirst?: string[];
  iCan?: string[];
  events?: Array<{ type: string; stage?: string; label?: string; text?: string; kind?: string; message?: string }>;
  operations?: CopilotOperation[];
  applied_operations?: CopilotOperation[];
  rejected_operations?: Array<{ operation: CopilotOperation; reason: string }>;
  needs_confirmation?: CopilotOperation[];
  needs_input?: string[];
  issues?: Array<{ code?: string; message: string; nodeId?: string }>;
  publishable?: boolean;
};

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
  return api<CopilotRefineResult>(`/copilot/sessions/${sessionId}/refine`, {
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

export type ClarificationQuestion = {
  question: string;
  options?: string[];
  required: boolean;
};

export type CopilotPlanResult = {
  requestId: string;
  sessionId?: string;
  reply: string;
  preview?: {
    summary: string;
    steps: Array<{ label: string; type: string; app: string }>;
    apps_used: Array<{ name: string; slug: string }>;
    missing_connections: string[];
    missing_information: string[];
    confidence: number;
  } | null;
  graph?: unknown;
  operations: CopilotOperation[];
  applied_operations?: CopilotOperation[];
  rejected_operations?: Array<{ operation: unknown; reason: string }>;
  needs_confirmation?: CopilotOperation[];
  issues?: Array<{ code?: string; message: string }>;
  needs_input: string[];
  clarificationQuestions?: ClarificationQuestion[];
  confidence?: number;
};

export async function planCopilotWorkflow(opts: {
  prompt: string;
  automationId?: string;
  graph?: unknown;
  requestId?: string;
}) {
  return api<CopilotPlanResult>("/ai/copilot/plan", {
    method: "POST",
    body: JSON.stringify({
      prompt: opts.prompt,
      automationId: opts.automationId,
      graph: opts.graph,
      requestId: opts.requestId,
    }),
  });
}
