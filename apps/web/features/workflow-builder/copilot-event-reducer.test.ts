import { describe, expect, it } from "vitest";
import { initialCopilotLiveState, reduceCopilotEvent } from "./copilot-event-reducer";

const reduce = (events: Parameters<typeof reduceCopilotEvent>[1][]) => events.reduce(reduceCopilotEvent, initialCopilotLiveState);

describe("reduceCopilotEvent", () => {
  it("keeps every reasoning summary instead of overwriting the previous one", () => {
    const state = reduce([
      { type: "agent_started" },
      { type: "reasoning", stage: "intent", text: "Understood the lead workflow." },
      { type: "reasoning", stage: "retrieve", text: "Found Forms and Tables." },
      { type: "reasoning", stage: "mapping", text: "Mapped lead fields." },
    ]);

    expect(state.blocks).toHaveLength(3);
    expect(state.blocks.map((b) => b.type)).toEqual(["analysis_summary", "analysis_summary", "analysis_summary"]);
    expect(state.blocks.map((b) => b.type === "analysis_summary" ? b.items[0] : "")).toEqual([
      "Understood the lead workflow.",
      "Found Forms and Tables.",
      "Mapped lead fields.",
    ]);
  });

  it("keeps stage progress and marks the same stage complete", () => {
    const state = reduce([
      { type: "stage", stage: "intent", status: "start" },
      { type: "stage", stage: "retrieve", status: "start" },
      { type: "stage", stage: "intent", status: "done" },
    ]);

    expect(state.activities).toHaveLength(2);
    expect(state.activities.find((x) => x.id === "stage:intent")?.kind).toBe("done");
    expect(state.activities.find((x) => x.id === "stage:retrieve")?.kind).toBe("running");
  });

  it("turns a missing connection into a blocking UI action", () => {
    const state = reduce([
      { type: "connection_required", appSlug: "slack", appName: "Slack", stepId: "step-2", message: "Connect Slack to continue." },
    ]);

    const block = state.blocks[0];
    expect(block.type).toBe("warning");
    if (block.type === "warning") {
      expect(block.actions?.[0]).toMatchObject({ type: "connect_account", appSlug: "slack", stepId: "step-2" });
    }
    expect(state.state).toBe("blocked");
  });
});
