import { describe, expect, it } from "vitest";
import { Executor, type StepHandler } from "./executor";

function makeDb() {
  const state = {
    status: "running",
    cursor: 0,
    transitionEpoch: 1,
    context: {},
    flowVersionId: "v1",
    runSteps: [] as Array<{ stepId: string; outputJson: Record<string, unknown> }>,
  };
  return {
    state,
    flowRuns: {
      async claimTransition() {
        return {
          id: "run1",
          orgId: "org1",
          createdAt: new Date().toISOString(),
          flowVersionId: "v1",
          contextJson: state.context,
          transitionEpoch: state.transitionEpoch,
          cursor: state.cursor,
        };
      },
      async checkpoint(_runId: string, input: any) {
        state.cursor = input.nextCursor;
        state.transitionEpoch += 1;
        state.context = { ...state.context, ...input.appendContext };
        return { cursor: state.cursor, transitionEpoch: state.transitionEpoch };
      },
      async finish(_runId: string, status: string, context: Record<string, unknown>) {
        state.status = status;
        state.context = context;
      },
      async pause() {},
      async resumeClaim() { return null; },
    },
    flowVersions: {
      async byId() {
        return {
          id: "v1",
          definition: {
            steps: [
              { id: "a", type: "piece_action", props: {} },
              { id: "b", type: "piece_action", props: {} },
            ],
          },
        };
      },
    },
    runSteps: {
      async completedByEffectKey() { return null; },
      async insert(input: any) {
        state.runSteps.push({ stepId: input.stepId, outputJson: input.outputJson ?? {} });
      },
    },
  };
}

describe("Executor test-step boundary", () => {
  it("finishes immediately after the requested target step", async () => {
    const db = makeDb();
    const handler: StepHandler = {
      async execute({ step }) {
        return { kind: "ok", output: { step: step.id } };
      },
    };
    const queues = { flowStep: { add: async () => undefined } };
    const executor = new Executor(db, queues, new Map([["piece_action", handler]]));

    db.state.context = { __testTargetStepId: "a" };
    await executor.transition("run1", 0, 1);

    expect(db.state.status).toBe("succeeded");
    expect(db.state.cursor).toBe(0);
    expect(db.state.context.a).toEqual({ step: "a" });
  });
});
