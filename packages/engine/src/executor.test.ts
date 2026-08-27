import assert from "node:assert/strict";
import test from "node:test";
import { parseFlowDefinition } from "@algoverge/core";
import { Executor, type StepHandler } from "./executor";

// ── Test helpers ────────────────────────────────────────────────────────────

function createMockDb(def: ReturnType<typeof parseFlowDefinition>, context: Record<string, unknown> = { trigger: { n: 1 } }) {
  let runStatus = "queued";
  let runContext: Record<string, unknown> = { ...context };
  let transitionEpoch = 1;

  const state = {
    get status() { return runStatus; },
    get context() { return runContext; },
  };

  const db: any = {
    flowRuns: {
      async claimTransition(_runId: string, _expectedCursor: number, expectedEpoch: number) {
        if (transitionEpoch !== expectedEpoch) return null;
        transitionEpoch += 1;
        return {
          id: "run1",
          orgId: "org1",
          flowVersionId: "v1",
          contextJson: runContext,
          transitionEpoch: transitionEpoch - 1,
          createdAt: new Date().toISOString(),
        };
      },
      async checkpoint(_runId: string, input: { appendContext: Record<string, unknown>; nextCursor: number; status: string; expectedEpoch: number }) {
        Object.assign(runContext, input.appendContext);
        runStatus = input.status;
        return { cursor: input.nextCursor, transitionEpoch: input.expectedEpoch + 1 };
      },
      async finish(_runId: string, status: string, context: unknown) {
        runStatus = status;
        runContext = context as Record<string, unknown>;
      },
      async pause(_runId: string, _input: unknown) {
        runStatus = "paused";
      },
    },
    flowVersions: {
      async byId() {
        return { id: "v1", definition: def };
      },
    },
    todos: {
      async create() { return { id: "todo1" }; },
    },
    runSteps: {
      async completedByEffectKey(_runId: string, _stepId: string, _key: string) { return null; },
      async insert() { },
    },
  };

  const queues: any = {
    flowStep: {
      async add() { return { id: "job1" }; },
    },
  };

  return { state, db, queues };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("filter halt does not run later steps", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      { id: "keep", type: "filter", condition: { op: "eq", left: "{{trigger.n}}", right: 2 } },
      { id: "http_1", type: "http", props: { method: "GET", url: "https://example.com" } },
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def);
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async () => ({ kind: "ok" as const, output: { ran: true } }) }],
  ]);
  const ex = new Executor(db, queues, handlers);
  await ex.transition("run1", 0, 1);
  assert.equal(state.status, "filtered");
  assert.equal(state.context.http_1, undefined);
});

test("branch walks onTrue and records leaf output", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      {
        id: "br",
        type: "branch",
        condition: { op: "eq", left: "{{trigger.n}}", right: 1 },
        onTrue: [{ id: "ok_step", type: "http", props: { method: "GET", url: "https://example.com" } }],
        onFalse: [],
      },
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def);
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async () => ({ kind: "ok" as const, output: { ok: true } }) }],
  ]);
  const ex = new Executor(db, queues, handlers);
  await ex.transition("run1", 0, 1);
  assert.equal(state.status, "succeeded");
  assert.deepEqual(state.context.ok_step, { ok: true });
});

test("transient handler errors retry then succeed", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      {
        id: "flaky",
        type: "http",
        retry: { maxAttempts: 3, backoff: "fixed" },
        props: { method: "GET", url: "https://example.com" },
      },
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def);
  let n = 0;
  const handlers = new Map<string, StepHandler>([
    ["http", {
      execute: async () => {
        n += 1;
        if (n < 2) throw new Error("timeout");
        return { kind: "ok" as const, output: { n } };
      },
    }],
  ]);
  const ex = new Executor(db, queues, handlers);
  await ex.transition("run1", 0, 1);
  assert.equal(state.status, "succeeded");
  assert.equal(n, 2);
});
