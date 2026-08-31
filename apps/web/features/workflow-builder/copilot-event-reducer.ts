import type {
  AgentActivityItem,
  AgentResponseBlock,
  AgentSSEEvent,
  AgentState,
  CopilotUIAction,
} from "./copilot-types";

export type CopilotStreamState = {
  status: AgentState;
  title: string;
  activities: AgentActivityItem[];
  blocks: AgentResponseBlock[];
  operationIndex: Record<string, number>;
};

export const initialCopilotStreamState: CopilotStreamState = {
  status: "idle",
  title: "Ready",
  activities: [],
  blocks: [],
  operationIndex: {},
};

function upsertActivity(
  state: CopilotStreamState,
  activity: AgentActivityItem,
): CopilotStreamState {
  const index = state.activities.findIndex((item) => item.id === activity.id);
  const activities = [...state.activities];
  if (index >= 0) activities[index] = { ...activities[index], ...activity };
  else activities.push(activity);
  return { ...state, activities };
}

function appendBlock(state: CopilotStreamState, block: AgentResponseBlock): CopilotStreamState {
  return { ...state, blocks: [...state.blocks, block] };
}

function actionList(value: unknown): CopilotUIAction[] | undefined {
  return Array.isArray(value) ? (value as CopilotUIAction[]) : undefined;
}

/**
 * Convert one streamed backend event into durable, renderable UI state.
 * This reducer intentionally treats reasoning as user-safe progress, never as
 * model chain-of-thought.
 */
export function reduceCopilotEvent(
  state: CopilotStreamState,
  event: AgentSSEEvent | Record<string, unknown>,
): CopilotStreamState {
  const ev = event as Record<string, unknown>;
  const type = String(ev.type ?? "");

  if (type === "agent_started") {
    return { ...state, status: "understanding", title: "Understanding your request" };
  }

  if (type === "agent_state") {
    const status = ev.state as AgentState;
    const title = typeof ev.title === "string" ? ev.title : state.title;
    return {
      ...state,
      status,
      title,
      blocks: [...state.blocks, { type: "status", state: status, title }],
    };
  }

  if (type === "agent_activity") {
    const id = String(ev.id ?? `activity-${state.activities.length + 1}`);
    return upsertActivity(state, {
      id,
      kind: (ev.kind as AgentActivityItem["kind"]) ?? "info",
      label: String(ev.label ?? "Working"),
      detail: typeof ev.detail === "string" ? ev.detail : undefined,
      timestamp: Date.now(),
    });
  }

  if (type === "reasoning") {
    // Backend may still emit this legacy event. Convert it into a safe activity
    // instead of storing/displaying raw internal reasoning.
    const text = typeof ev.text === "string" ? ev.text.trim() : "";
    if (!text) return state;
    return upsertActivity(state, {
      id: `reasoning-${state.activities.length + 1}`,
      kind: "info",
      label: text,
      timestamp: Date.now(),
    });
  }

  if (type === "analysis_summary") {
    return appendBlock(state, {
      type: "analysis_summary",
      title: String(ev.title ?? "Understanding your request"),
      items: Array.isArray(ev.items) ? ev.items.map(String) : [],
    });
  }

  if (type === "operation_started") {
    const operationId = String(ev.operationId);
    const block: AgentResponseBlock = {
      type: "operation",
      operationId,
      label: String(ev.label ?? ev.kind ?? "Working"),
      status: "running",
      detail: typeof ev.detail === "string" ? ev.detail : undefined,
    };
    const index = state.operationIndex[operationId];
    if (index !== undefined) {
      const blocks = [...state.blocks];
      blocks[index] = block;
      return { ...state, blocks };
    }
    return {
      ...state,
      operationIndex: { ...state.operationIndex, [operationId]: state.blocks.length },
      blocks: [...state.blocks, block],
    };
  }

  if (type === "operation_completed") {
    const operationId = String(ev.operationId);
    const index = state.operationIndex[operationId];
    const block: AgentResponseBlock = {
      type: "operation",
      operationId,
      label: String(ev.label ?? ev.kind ?? "Operation"),
      status: ev.success === false ? "failed" : "completed",
      detail: typeof ev.detail === "string" ? ev.detail : undefined,
    };
    if (index === undefined) {
      return {
        ...state,
        operationIndex: { ...state.operationIndex, [operationId]: state.blocks.length },
        blocks: [...state.blocks, block],
      };
    }
    const blocks = [...state.blocks];
    blocks[index] = block;
    return { ...state, blocks };
  }

  if (type === "connection_required") {
    return appendBlock(state, {
      type: "connection_card",
      appSlug: String(ev.appSlug),
      appName: String(ev.appName ?? ev.appSlug),
      connected: false,
      message: typeof ev.message === "string" ? ev.message : undefined,
      actions: actionList(ev.actions) ?? [{
        type: "connect_account",
        label: `Connect ${String(ev.appName ?? ev.appSlug)}`,
        appSlug: String(ev.appSlug),
        stepId: typeof ev.stepId === "string" ? ev.stepId : undefined,
      }],
    });
  }

  if (type === "field_mapping" || type === "field_mapping_suggestion") {
    return appendBlock(state, {
      type: "field_mapping",
      sourceLabel: String(ev.sourceLabel ?? "Source"),
      sourceFields: Array.isArray(ev.sourceFields) ? ev.sourceFields.map(String) : [],
      targetLabel: String(ev.targetLabel ?? "Target"),
      targetFields: Array.isArray(ev.targetFields) ? ev.targetFields.map(String) : [],
      mappings: Array.isArray(ev.mappings) ? (ev.mappings as Array<{ source: string; target: string }>) : [],
    });
  }

  if (type === "test_result") {
    return appendBlock(state, {
      type: "test_result",
      stepLabel: String(ev.label ?? "Workflow step"),
      success: ev.success === true,
      fields: (ev.fields ?? undefined) as Record<string, unknown> | undefined,
      actions: actionList(ev.actions),
    });
  }

  if (type === "blocking_issue") {
    return appendBlock(state, {
      type: "warning",
      title: String(ev.title ?? "Needs your attention"),
      message: typeof ev.detail === "string" ? ev.detail : undefined,
      actions: actionList(ev.actions),
    });
  }

  if (type === "agent_error") {
    return appendBlock(state, {
      type: "error",
      title: "Something went wrong",
      message: typeof ev.message === "string" ? ev.message : undefined,
      actions: actionList(ev.actions),
    });
  }

  if (type === "agent_completed") {
    return {
      ...state,
      status: "completed",
      title: "Done",
      blocks: [...state.blocks, {
        type: "success",
        title: "Completed",
        message: typeof ev.summary === "string" ? ev.summary : undefined,
        actions: actionList(ev.actions),
      }],
    };
  }

  if (type === "plan" && ev.plan && typeof ev.plan === "object") {
    const plan = ev.plan as Record<string, unknown>;
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    return appendBlock(state, {
      type: "plan",
      goal: String(plan.goal ?? ""),
      steps: steps.map((step) => {
        const item = step as Record<string, unknown>;
        return {
          label: String(item.label ?? "Step"),
          product: String(item.product ?? "workflow"),
          description: String(item.description ?? ""),
        };
      }),
      actions: actionList(plan.actions),
    });
  }

  return state;
}
