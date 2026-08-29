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
  plan?: AutomationPlan | null;
  operations?: CopilotOperation[];
  applied_operations?: CopilotOperation[];
  rejected_operations?: Array<{ operation: CopilotOperation; reason: string }>;
  needs_confirmation?: CopilotOperation[];
  needs_input?: string[];
  issues?: Array<{ code?: string; message: string; nodeId?: string }>;
};

/** AutomationPlan IR from the enhanced copilot pipeline */
export type AutomationPlan = {
  goal: string;
  summary: string;
  confidence: number;
  steps: Array<{
    id: string;
    type: string;
    label: string;
    description: string;
    order: number;
    appSlug: string | null;
    operation: string | null;
    liveAdapter: boolean;
    confidence: number;
    connectionRequired: boolean;
    connectionId: string | null;
  }>;
  connections: Array<{ stepId: string; appSlug: string; connectionId: string; status: string }>;
  attentionItems: Array<{ kind: string; message: string; appSlug?: string }>;
  availableData: Array<{ stepId: string; label: string; fields: string[] }>;
  warnings: string[];
  missingInformation: string[];
  modificationType: string;
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
  // Handle AutomationPlan events from enhanced pipeline
  if (ev.type === "plan" && ev.plan) {
    out.plan = ev.plan as AutomationPlan;
    return;
  }
  if (ev.type !== "proposal" && ev.type !== "result") return;
  if (ev.graph) out.graph = ev.graph;
  if (ev.summary) out.summary = String(ev.summary);
  if ("applied" in ev) out.applied = Boolean(ev.applied);
  if ("rebuilt" in ev) out.rebuilt = Boolean(ev.rebuilt);
  if ("changed" in ev) out.changed = Boolean(ev.changed);
  if (ev.source) out.source = String(ev.source);
  // Carry forward plan from earlier event
  if (ev.plan) out.plan = ev.plan as AutomationPlan;
  if (Array.isArray(ev.operations)) out.operations = ev.operations as CopilotOperation[];
  if (Array.isArray(ev.applied_operations)) out.applied_operations = ev.applied_operations as CopilotOperation[];
  if (Array.isArray(ev.rejected_operations)) out.rejected_operations = ev.rejected_operations as CopilotDraft["rejected_operations"];
  if (Array.isArray(ev.needs_confirmation)) out.needs_confirmation = ev.needs_confirmation as CopilotOperation[];
  if (Array.isArray(ev.needs_input)) out.needs_input = ev.needs_input as string[];
  if (Array.isArray(ev.issues)) out.issues = ev.issues as CopilotDraft["issues"];
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

/**
 * Approve the server-stored Copilot proposal.
 *
 * Deliberately accepts only the session/flow identifiers. The browser never
 * sends the operation list, graph, credentials, or other executable payload.
 * The API loads the pending confirmation-gated operations from the session,
 * revalidates them against the current workflow/catalog, applies them, and
 * returns the authoritative resulting graph.
 */
export async function approveCopilotSession(sessionId: string, flowId?: string) {
  return api<{
    ok: boolean;
    sessionId: string;
    flowId?: string;
    graph?: unknown;
    definition?: unknown;
    applied_operations: CopilotOperation[];
    rejected_operations: Array<{ operation: CopilotOperation; reason: string }>;
    needs_confirmation: CopilotOperation[];
    issues: Array<{ code?: string; message: string; nodeId?: string }>;
    publishable: boolean;
  }>(`/copilot/sessions/${encodeURIComponent(sessionId)}/approve`, {
    method: "POST",
    body: JSON.stringify(flowId ? { flowId } : {}),
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
  /** Enhanced AutomationPlan IR from copilot-plan-builder */
  plan?: AutomationPlan | null;
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

// ── Graph Patch API ──────────────────────────────────────────────────────

export type GraphPatchOp = {
  op: "add_node" | "remove_node" | "update_node" | "replace_node" | "connect" | "disconnect" | "update_config" | "map_field" | "add_delay" | "add_approval";
  target_node_id?: string;
  after_node_id?: string;
  before_node_id?: string;
  node?: Record<string, unknown>;
  source?: string;
  target?: string;
  field?: string;
  value?: unknown;
  expression?: string;
  config?: Record<string, unknown>;
};

export type GraphPatchResult = {
  ok: boolean;
  graph: { nodes: unknown[]; edges: unknown[] };
  applied: Array<{ op: string; target?: string }>;
  rejected: Array<{ op: string; issue: string }>;
};

/** Apply incremental graph patches instead of full rebuild */
export async function applyGraphPatches(opts: {
  flowId?: string;
  graph?: Record<string, unknown>;
  patches: GraphPatchOp[];
  description?: string;
}) {
  return api<GraphPatchResult>("/copilot/patch", {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

// ── Context Engine API ───────────────────────────────────────────────────

export type CopilotContext = {
  workspace: { id: string; name: string; timezone: string };
  workflow: { id: string; name: string; status: string; graph: Record<string, unknown>; nodeCount: number; nodesSummary: Array<{ id: string; appSlug: string; operation: string; label: string }> } | null;
  connections: Array<{ id: string; name: string; app_slug: string; status: string }>;
  recentRuns: Array<{ id: string; status: string; flow_name: string; created_at: string }>;
  catalog: { totalApps: number; totalOperations: number; liveAdapters: string[]; topApps: Array<{ slug: string; name: string; ops: number }> };
  selectedNodeId?: string;
  page?: string;
};

/** Get assembled context for a Copilot request */
export async function getCopilotContext(opts: {
  flowId?: string;
  selectedNodeId?: string;
  page?: string;
}) {
  return api<CopilotContext>("/copilot/context", {
    method: "POST",
    body: JSON.stringify(opts),
  });
}
