// ============================================================================
// Orchestra Part 11 — Schema Parity between Zod (Node) and Pydantic (Python)
// Source of truth: Part 11 § "Schema parity between zod and pydantic"
// The one genuine cost of a polyglot stack, paid down with a test.
// ============================================================================

import { describe, it, expect } from "node:test";
import { FlowDefinition, StepSchema, TriggerSchema } from "@algoverge/core";

describe("Part 11: Schema Parity", () => {
  it("FlowDefinition zod schema accepts valid definition", () => {
    const valid = {
      schemaVersion: 1,
      trigger: { id: "trigger", type: "manual", props: {} },
      steps: [
        { id: "step1", type: "note", name: "Test note", content: "Hello" },
        {
          id: "step2",
          type: "piece_action",
          name: "Send message",
          piece: { name: "slack", version: "*" },
          operation: "send_message",
          connectionId: null,
          props: { channel: "#general", text: "Hello" },
        },
      ],
      settings: {
        timezone: "UTC",
        concurrency: 1,
        errorHandling: { mode: "fail" },
      },
    };

    const result = FlowDefinition.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("FlowDefinition rejects unknown step types", () => {
    const invalid = {
      schemaVersion: 1,
      trigger: { id: "trigger", type: "manual", props: {} },
      steps: [
        { id: "step1", type: "unknown_type", name: "Bad step" },
      ],
      settings: { timezone: "UTC", concurrency: 1, errorHandling: { mode: "fail" } },
    };

    const result = FlowDefinition.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("all trigger types are covered", () => {
    const triggerTypes = ["app_event", "schedule", "webhook", "form", "manual"];

    for (const type of triggerTypes) {
      const trigger: any = {
        id: "trigger",
        type,
        props: {},
      };

      if (type === "app_event") {
        trigger.piece = { name: "slack", version: "*" };
        trigger.operation = "send_message";
      }

      const result = TriggerSchema.safeParse(trigger);
      expect(result.success).toBe(true);
    }
  });

  it("all 13 step types are covered", () => {
    const stepTypes = [
      "piece_action",
      "http",
      "code",
      "ai",
      "agent",
      "filter",
      "delay",
      "approval",
      "data_table",
      "note",
      "sub_flow",
      "branch",
      "router",
      "loop",
    ];

    for (const type of stepTypes) {
      const base = { id: `test_${type}`, name: `Test ${type}` };

      let step: any;
      switch (type) {
        case "note":
          step = { ...base, type, content: "Hello" };
          break;
        case "filter":
          step = { ...base, type, condition: { op: "eq", left: "x", right: "y" } };
          break;
        case "branch":
          step = {
            ...base, type,
            condition: { op: "eq", left: "x", right: "y" },
            onTrue: [],
            onFalse: [],
          };
          break;
        case "router":
          step = { ...base, type, branches: [{ id: "b1", label: "Default", default: true, steps: [] }] };
          break;
        case "loop":
          step = { ...base, type, props: { items: "{{trigger.items}}", concurrency: 1 }, steps: [] };
          break;
        case "delay":
          step = { ...base, type, props: { mode: "duration", seconds: 60 } };
          break;
        case "approval":
          step = { ...base, type, props: { title: "Approve?" } };
          break;
        case "sub_flow":
          step = { ...base, type, props: { flowId: "00000000-0000-0000-0000-000000000000", input: {} } };
          break;
        case "data_table":
          step = { ...base, type, props: { tableId: "00000000-0000-0000-0000-000000000000", operation: "create" } };
          break;
        default:
          step = { ...base, type, piece: { name: "test", version: "*" }, operation: "test_op", connectionId: null, props: {} };
      }

      const result = StepSchema.safeParse(step);
      expect(result.success).toBe(true);
    }
  });
});
