export type CopilotMode = "auto_build" | "ask_as_you_build";

// ── Agent State Machine ─────────────────────────────────────────────────────
export type AgentState =
  | "idle"
  | "understanding"
  | "inspecting"
  | "planning"
  | "executing"
  | "testing"
  | "validating"
  | "waiting_for_user"
  | "completed"
  | "blocked"
  | "error";

// ── Agent Activity Events ───────────────────────────────────────────────────
export type AgentActivityKind = "done" | "running" | "warn" | "error" | "info";

export type AgentActivityItem = {
  id: string;
  kind: AgentActivityKind;
  label: string;
  detail?: string;
  timestamp: number;
};

// ── Structured Response Blocks ──────────────────────────────────────────────
export type AgentResponseBlock =
  | { type: "text"; content: string }
  | { type: "activity"; items: AgentActivityItem[] }
  | { type: "status"; state: AgentState; title: string }
  | { type: "warning"; title: string; message?: string }
  | { type: "error"; title: string; message?: string }
  | { type: "success"; title: string; message?: string }
  | { type: "question"; question: string; options: Array<{ label: string; prompt: string; description?: string }> }
  | { type: "action"; label: string; prompt: string; icon?: string }
  | { type: "step_card"; stepIndex: number; label: string; app?: string; status: "configured" | "needs_config" | "needs_connection" | "needs_action" | "tested"; issues?: string[]; actions?: Array<{ label: string; prompt: string }> }
  | { type: "field_mapping"; sourceLabel: string; sourceFields: string[]; targetLabel: string; targetFields: string[]; mappings: Array<{ source: string; target: string }> }
  | { type: "test_result"; stepLabel: string; success: boolean; fields?: Record<string, unknown>; actions?: Array<{ label: string; prompt: string }> }
  | { type: "plan"; goal: string; steps: Array<{ label: string; product: string; description: string }>; actions?: Array<{ label: string; prompt: string }> };

// ── Agent Tool Operations ───────────────────────────────────────────────────
export type AgentOperation =
  | { type: "inspect_workflow" }
  | { type: "inspect_step"; stepId: string }
  | { type: "select_step"; stepId: string }
  | { type: "add_step"; afterStepId?: string; appSlug?: string; operation?: string }
  | { type: "remove_step"; stepId: string }
  | { type: "update_step"; stepId: string; changes: Record<string, unknown> }
  | { type: "choose_app"; stepId: string; appSlug: string }
  | { type: "choose_action"; stepId: string; operation: string }
  | { type: "configure_step"; stepId: string; config: Record<string, unknown> }
  | { type: "map_field"; stepId: string; field: string; expression: string }
  | { type: "test_step"; stepId: string }
  | { type: "validate_step"; stepId: string }
  | { type: "connect_account"; stepId: string; appSlug: string }
  | { type: "save_workflow" }
  | { type: "undo_change" };

// ── SSE Event Types from Backend ────────────────────────────────────────────
export type AgentSSEEvent =
  | { type: "agent_started" }
  | { type: "agent_state"; state: AgentState; title: string }
  | { type: "agent_activity"; kind: AgentActivityKind; label: string; detail?: string; id?: string }
  | { type: "step_completed"; stepId: string; label: string; success: boolean; detail?: string }
  | { type: "blocking_issue"; stepId?: string; title: string; detail?: string; actions?: Array<{ label: string; prompt: string }> }
  | { type: "field_mapping_suggestion"; sourceLabel: string; sourceFields: string[]; targetLabel: string; targetFields: string[]; mappings: Array<{ source: string; target: string }> }
  | { type: "test_result"; stepId: string; label: string; success: boolean; fields?: Record<string, unknown>; actions?: Array<{ label: string; prompt: string }> }
  | { type: "agent_completed"; summary: string; actions?: Array<{ label: string; prompt: string }> }
  | { type: "agent_error"; message: string; recoverable: boolean; actions?: Array<{ label: string; prompt: string }> }
  | { type: "chat_result"; reply: string; graph?: unknown; sessionId?: string; applied?: boolean; suggestions?: unknown; clarification?: unknown; operations?: unknown; systemPlan?: unknown };
