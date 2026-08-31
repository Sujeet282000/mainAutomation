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

/**
 * Reduces streaming events without losing previous progress.
 * This is intentionally deterministic so reconnects/replayed SSE events are safe.
 */
export function reduceCopilotEvent(
  current: CopilotLiveState,
  event: AgentSSEEvent,
): CopilotLiveState {
  switch (event.type) {
    case "agent_started":
      return { ...initialCopilotLiveState, state: "working", title: "Working on your request" };

    case "agent_state":
      return {
        ...current,
        state:
          event.state === "completed"
            ? "completed"
            : event.state === "blocked" || event.state === "waiting_for_user"
              ? "blocked"
              : event.state === "error"
                ? "error"
                : "working",
        title: event.title,
      };

    case "agent_activity": {
      const next = {
        id: activityId(event, current.activities.length),
        kind: event.kind,
        label: event.label,
        detail: event.detail,
        timestamp: Date.now(),
      } satisfies AgentActivityItem;
      const existing = current.activities.findIndex((item) => item.id === next.id);
      const activities = [...current.activities];
      if (existing >= 0) activities[existing] = { ...activities[existing], ...next };
      else activities.push(next);
      return { ...current, state: "working", activities };
    }

    case "analysis_summary":
      return {
        ...current,
        state: "working",
        blocks: [
          ...current.blocks,
          { type: "analysis_summary", title: event.title, items: event.items },
        ],
      };

    case "operation_started":
      return {
        ...current,
        state: "working",
        activities: [
          ...current.activities,
          {
            id: event.operationId,
            kind: "running",
            label: event.label,
            detail: event.detail,
            timestamp: Date.now(),
          },
        ],
      };

    case "operation_completed":
      return {
        ...current,
        activities: current.activities.map((item) =>
          item.id === event.operationId
            ? {
                ...item,
                kind: event.success ? "done" : "error",
                detail: event.detail,
              }
            : item,
        ),
      };

    case "connection_required":
      return {
        ...current,
        state: "blocked",
        blocks: [
          ...current.blocks,
          {
            type: "warning",
            title: event.appName ? `Connect ${event.appName}` : "Connection required",
            message: event.message,
            actions: [
              {
                type: "connect_account",
                label: event.appName ? `Connect ${event.appName}` : "Connect account",
                appSlug: event.appSlug,
                stepId: event.stepId,
              },
            ],
          },
        ],
      };

    case "field_mapping_suggestion":
      return {
        ...current,
        blocks: [
          ...current.blocks,
          {
            type: "field_mapping",
            sourceLabel: event.sourceLabel,
            sourceFields: event.sourceFields,
            targetLabel: event.targetLabel,
            targetFields: event.targetFields,
            mappings: event.mappings,
          },
        ],
      };

    case "test_result":
      return {
        ...current,
        blocks: [
          ...current.blocks,
          {
            type: "test_result",
            stepLabel: event.label,
            success: event.success,
            fields: event.fields,
            actions: event.actions,
          },
        ],
      };

    case "blocking_issue":
      return {
        ...current,
        state: "blocked",
        blocks: [
          ...current.blocks,
          { type: "warning", title: event.title, message: event.detail, actions: event.actions },
        ],
      };

    case "agent_completed":
      return {
        ...current,
        state: "completed",
        title: "Done",
        blocks: [
          ...current.blocks,
          { type: "success", title: "Completed", message: event.summary, actions: event.actions },
        ],
      };

    case "agent_error":
      return {
        ...current,
        state: "error",
        title: "Something went wrong",
        blocks: [
          ...current.blocks,
          { type: "error", title: "Copilot could not complete this", message: event.message, actions: event.actions },
        ],
      };

    default:
      return current;
  }
}
