import type { AgentActivityItem, AgentResponseBlock, AgentSSEEvent } from "./copilot-types";

export type CopilotLiveState = {
  state: "idle" | "working" | "completed" | "blocked" | "error";
  title: string;
  activities: AgentActivityItem[];
  blocks: AgentResponseBlock[];
};

export const initialCopilotLiveState: CopilotLiveState = {
  state: "idle",
  title: "Ready",
  activities: [],
  blocks: [],
};

function activityId(event: Extract<AgentSSEEvent, { type: "agent_activity" }>, index: number) {
  return event.id || `${event.kind}-${index}-${event.label}`;
}

function stageLabel(stage: string, label?: string) {
  if (label) return label;
  const labels: Record<string, string> = {
    intent: "Understanding your request",
    retrieve: "Finding apps and events",
    select: "Selecting operations",
    connections: "Checking connections",
    schemas: "Reading data fields",
    mapping: "Mapping fields",
    assemble: "Building workflow",
    validate: "Validating workflow",
    repair: "Repairing the draft",
    persist: "Saving the draft",
  };
  return labels[stage] || stage;
}

/**
 * Deterministic reducer for Copilot SSE. It deliberately accumulates progress
 * instead of replacing the previous reasoning/activity item.
 */
export function reduceCopilotEvent(current: CopilotLiveState, event: AgentSSEEvent): CopilotLiveState {
  switch (event.type) {
    case "agent_started":
      return { ...initialCopilotLiveState, state: "working", title: "Working on your request" };

    case "agent_state":
      return {
        ...current,
        state: event.state === "completed" ? "completed" : event.state === "blocked" || event.state === "waiting_for_user" ? "blocked" : event.state === "error" ? "error" : "working",
        title: event.title,
      };

    case "stage": {
      const label = stageLabel(event.stage, event.label);
      const existing = current.activities.find((item) => item.id === `stage:${event.stage}`);
      const item: AgentActivityItem = {
        id: `stage:${event.stage}`,
        kind: event.status === "done" ? "done" : "running",
        label,
        timestamp: existing?.timestamp || Date.now(),
      };
      return {
        ...current,
        state: "working",
        activities: existing ? current.activities.map((x) => x.id === item.id ? { ...x, ...item } : x) : [...current.activities, item],
      };
    }

    case "reasoning":
      return {
        ...current,
        state: "working",
        blocks: [
          ...current.blocks,
          { type: "analysis_summary", title: stageLabel(event.stage || "analysis"), items: [event.text] },
        ],
      };

    case "todo":
      return {
        ...current,
        state: "blocked",
        blocks: [...current.blocks, { type: "warning", title: event.kind === "clarify" ? "Your input is needed" : "Attention needed", message: event.message }],
      };

    case "done":
      return event.status === "awaiting_input" ? { ...current, state: "blocked", title: "Waiting for your choice" } : current;

    case "agent_activity": {
      const next = { id: activityId(event, current.activities.length), kind: event.kind, label: event.label, detail: event.detail, timestamp: Date.now() } satisfies AgentActivityItem;
      const existing = current.activities.findIndex((item) => item.id === next.id);
      const activities = [...current.activities];
      if (existing >= 0) activities[existing] = { ...activities[existing], ...next };
      else activities.push(next);
      return { ...current, state: "working", activities };
    }

    case "analysis_summary":
      return { ...current, state: "working", blocks: [...current.blocks, { type: "analysis_summary", title: event.title, items: event.items }] };

    case "operation_started":
      return {
        ...current,
        state: "working",
        activities: [...current.activities.filter((x) => x.id !== event.operationId), { id: event.operationId, kind: "running", label: event.label, detail: event.detail, timestamp: Date.now() }],
      };

    case "operation_completed":
      return {
        ...current,
        activities: current.activities.map((item) => item.id === event.operationId ? { ...item, kind: event.success ? "done" : "error", detail: event.detail } : item),
      };

    case "connection_required":
      return {
        ...current,
        state: "blocked",
        blocks: [...current.blocks, { type: "warning", title: event.appName ? `Connect ${event.appName}` : "Connection required", message: event.message, actions: [{ type: "connect_account", label: event.appName ? `Connect ${event.appName}` : "Connect account", appSlug: event.appSlug, stepId: event.stepId }] }],
      };

    case "field_mapping":
      return {
        ...current,
        blocks: [...current.blocks, { type: "field_mapping", sourceLabel: event.sourceLabel, sourceFields: event.mappings.map((m) => m.source), targetLabel: event.targetLabel, targetFields: event.mappings.map((m) => m.target), mappings: event.mappings }],
      };

    case "field_mapping_suggestion":
      return {
        ...current,
        blocks: [...current.blocks, { type: "field_mapping", sourceLabel: event.sourceLabel, sourceFields: event.sourceFields, targetLabel: event.targetLabel, targetFields: event.targetFields, mappings: event.mappings }],
      };

    case "test_result":
      return {
        ...current,
        blocks: [...current.blocks, { type: "test_result", stepLabel: event.label, success: event.success, fields: event.fields, actions: event.actions }],
      };

    case "blocking_issue":
      return {
        ...current,
        state: "blocked",
        blocks: [...current.blocks, { type: "warning", title: event.title, message: event.detail, actions: event.actions }],
      };

    case "operation_card":
      return { ...current, blocks: [...current.blocks, { type: "actions", actions: [] }] };

    case "plan": {
      const plan = event.plan as { goal?: string; steps?: Array<{ label?: string; product?: string; description?: string }> };
      return {
        ...current,
        blocks: [...current.blocks, { type: "plan", goal: plan.goal || "Proposed automation", steps: (plan.steps || []).map((s) => ({ label: s.label || "Step", product: s.product || "workflow", description: s.description || "" })) }],
      };
    }

    case "agent_completed":
      return { ...current, state: "completed", title: "Done", blocks: [...current.blocks, { type: "success", title: "Completed", message: event.summary, actions: event.actions }] };

    case "agent_error":
      return { ...current, state: "error", title: "Something went wrong", blocks: [...current.blocks, { type: "error", title: "Copilot could not complete this", message: event.message, actions: event.actions }] };

    default:
      return current;
  }
}
