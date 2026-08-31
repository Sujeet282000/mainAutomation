import { describe, expect, it } from "vitest";
import { initialCopilotStreamState, reduceCopilotEvent } from "./copilot-event-reducer";

describe("reduceCopilotEvent", () => {
  it("keeps operation start and completion in one UI block", () => {
    let state = reduceCopilotEvent(initialCopilotStreamState, {
      type: "operation_started",
      operationId: "op-1",
      kind: "add_step",
      label: "Add lead qualification",
    });
    state = reduceCopilotEvent(state, {
      type: "operation_completed",
      operationId: "op-1",
      kind: "add_step",
      label: "Add lead qualification",
      success: true,
    });

    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toMatchObject({ type: "operation", operationId: "op-1", status: "completed" });
  });

  it("turns a missing connection into an actionable connection card", () => {
    const state = reduceCopilotEvent(initialCopilotStreamState, {
      type: "connection_required",
      appSlug: "slack",
      appName: "Slack",
    });

    expect(state.blocks[0]).toMatchObject({ type: "connection_card", appSlug: "slack", connected: false });
    expect((state.blocks[0] as { actions?: Array<{ type: string }> }).actions?.[0]?.type).toBe("connect_account");
  });

  it("surfaces safe progress without requiring private model reasoning", () => {
    const state = reduceCopilotEvent(initialCopilotStreamState, {
      type: "agent_activity",
      kind: "running",
      label: "Checking available apps",
    });

    expect(state.activities[0]).toMatchObject({ kind: "running", label: "Checking available apps" });
  });

  it("moves the stream to blocked on an actionable blocking issue", () => {
    const state = reduceCopilotEvent(initialCopilotStreamState, {
      type: "blocking_issue",
      title: "Google Calendar needs a connection",
      detail: "Connect an account before testing this step.",
      actions: [{ type: "connect_account", label: "Connect Google Calendar", appSlug: "google-calendar" }],
    });

    expect(state.status).toBe("blocked");
    expect(state.blocks[0]).toMatchObject({ type: "warning", title: "Google Calendar needs a connection" });
  });
});
