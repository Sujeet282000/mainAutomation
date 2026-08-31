export type CopilotMode = "auto_build" | "ask_as_you_build";

export type AgentState =
  | "idle" | "understanding" | "inspecting" | "planning" | "executing" | "testing"
  | "validating" | "waiting_for_user" | "completed" | "blocked" | "error";

export type AgentActivityKind = "done" | "running" | "warn" | "error" | "info";
export type AgentActivityItem = { id: string; kind: AgentActivityKind; label: string; detail?: string; timestamp: number };

export type CopilotUIAction = {
  type:
    | "prompt" | "navigate" | "connect_account" | "choose_app" | "choose_action" | "select_step"
    | "add_step" | "remove_step" | "test_step" | "test_workflow" | "apply_change" | "open_form"
    | "open_table" | "open_canvas" | "open_workflow" | "open_agent" | "open_chatbot" | "open_connection" | "retry";
  label: string;
  prompt?: string;
  href?: string;
  appSlug?: string;
  stepId?: string;
  operationId?: string;
};

export type AgentResponseBlock =
  | { type: "text"; content: string }
  | { type: "activity"; items: AgentActivityItem[] }
  | { type: "status"; state: AgentState; title: string }
  | { type: "analysis_summary"; title: string; items: string[] }
  | { type: "warning"; title: string; message?: string; actions?: CopilotUIAction[] }
  | { type: "error"; title: string; message?: string; actions?: CopilotUIAction[] }
  | { type: "success"; title: string; message?: string; actions?: CopilotUIAction[] }
  | { type: "question"; question: string; options: Array<{ label: string; prompt: string; description?: string }> }
  | { type: "actions"; actions: CopilotUIAction[] }
  | { type: "step_card"; stepIndex: number; label: string; app?: string; status: "configured" | "needs_config" | "needs_connection" | "needs_action" | "tested"; issues?: string[]; actions?: CopilotUIAction[] }
  | { type: "field_mapping"; sourceLabel: string; sourceFields: string[]; targetLabel: string; targetFields: string[]; mappings: Array<{ source: string; target: string }> }
  | { type: "test_result"; stepLabel: string; success: boolean; fields?: Record<string, unknown>; actions?: CopilotUIAction[] }
  | { type: "plan"; goal: string; steps: Array<{ label: string; product: string; description: string }>; actions?: CopilotUIAction[] };

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

export type AgentSSEEvent =
  | { type: "agent_started" }
  | { type: "agent_state"; state: AgentState; title: string }
  | { type: "stage"; stage: string; status: "start" | "done"; label?: string }
  | { type: "reasoning"; stage?: string; text: string }
  | { type: "todo"; kind: string; message: string; field?: string; assumption?: string }
  | { type: "done"; status: string; session_id?: string }
  | { type: "agent_activity"; kind: AgentActivityKind; label: string; detail?: string; id?: string }
  | { type: "analysis_summary"; title: string; items: string[] }
  | { type: "operation_started"; operationId: string; kind: string; label: string; detail?: string }
  | { type: "operation_completed"; operationId: string; kind: string; label: string; success: boolean; detail?: string }
  | { type: "connection_required"; stepId?: string; appSlug: string; appName?: string; message?: string }
  | { type: "step_completed"; stepId: string; label: string; success: boolean; detail?: string }
  | { type: "blocking_issue"; stepId?: string; title: string; detail?: string; actions?: CopilotUIAction[] }
  | { type: "field_mapping"; stepId?: string; sourceLabel: string; targetLabel: string; mappings: Array<{ source: string; target: string }> }
  | { type: "field_mapping_suggestion"; sourceLabel: string; sourceFields: string[]; targetLabel: string; targetFields: string[]; mappings: Array<{ source: string; target: string }> }
  | { type: "test_result"; stepId?: string; label: string; success: boolean; fields?: Record<string, unknown>; actions?: CopilotUIAction[] }
  | { type: "plan"; plan: Record<string, unknown> }
  | { type: "operation_card"; operation: Record<string, unknown> }
  | { type: "agent_completed"; summary: string; actions?: CopilotUIAction[] }
  | { type: "agent_error"; message: string; recoverable: boolean; actions?: CopilotUIAction[] }
  | { type: "chat_result"; reply: string; graph?: unknown; sessionId?: string; applied?: boolean; suggestions?: unknown; clarification?: unknown; operations?: unknown; systemPlan?: unknown; thinking?: string };
