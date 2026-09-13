import assert from "node:assert/strict";
import test from "node:test";
import { parseFlowDefinition } from "@algoverge/core";
import { EngineError, Executor, type StepHandler } from "./executor";

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

test("delay with mode duration pauses with a concrete resumeAt and schedules a resume job", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      { id: "wait", type: "delay", props: { mode: "duration", seconds: 30 } as any },
      { id: "http_1", type: "http", props: { method: "GET", url: "https://example.com" } },
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def);
  const pauseInputs: any[] = [];
  db.flowRuns.pause = async (_runId: string, input: any) => { pauseInputs.push(input); (state as any).paused = true; };
  const addedJobs: any[] = [];
  queues.flowStep.add = async (_name: string, data: any, opts: any) => { addedJobs.push({ data, opts }); return { id: "job1" }; };
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async () => ({ kind: "ok" as const, output: {} }) }],
  ]);
  const ex = new Executor(db, queues, handlers);
  await ex.transition("run1", 0, 1);
  assert.equal((state as any).paused, true, "run must be paused after a duration delay");
  assert.ok(pauseInputs[0]?.resumeAt, "resumeAt must be set for a duration delay");
  const resumeJob = addedJobs.find((j) => j.data?.kind === "resume");
  assert.ok(resumeJob, "a delayed resume job must be scheduled");
  assert.ok(resumeJob.opts?.delay >= 25_000, "resume job delay should approximate the configured duration");
});

test("retry policy honors retryOn: auth errors are not retried when not listed", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      {
        id: "auth_fail",
        type: "http",
        retry: { maxAttempts: 5, backoff: "fixed", retryOn: ["transient"] } as any,
        props: { method: "GET", url: "https://example.com" },
      },
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def);
  let attempts = 0;
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async () => { attempts += 1; throw new Error("401 unauthorized"); } }],
  ]);
  const ex = new Executor(db, queues, handlers);
  await ex.transition("run1", 0, 1);
  assert.equal(state.status, "failed");
  assert.equal(attempts, 1, "auth errors must not be retried when retryOn excludes them");
});

test("onError continue records the failure and keeps executing downstream", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      { id: "boom", type: "http", onError: "continue" as any, retry: { maxAttempts: 1 } as any, props: { method: "GET", url: "https://example.com" } },
      { id: "after", type: "http", props: { method: "GET", url: "https://example.com" } },
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def);
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async (ctx) => { if (ctx.step.id === "boom") throw new Error("429 rate limit"); return { kind: "ok" as const, output: { ran: true } }; } }],
  ]);
  const ex = new Executor(db, queues, handlers);
  // Transition 1: boom fails → onError=continue checkpoints to cursor 1.
  await ex.transition("run1", 0, 1);
  // Transition 2: the enqueued continuation runs the downstream step.
  await ex.transition("run1", 1, 2);
  assert.equal(state.status, "succeeded");
  assert.ok(state.context.after, "downstream step must run after onError=continue");
  assert.ok((state.context.boom as any)?.error, "the failed step records its error");
});

async function waitFor<T>(fn: () => T | undefined | null): Promise<T> {
  return (await fn()) as T;
}

// ── Golden engine tests: router, loop concurrency, nested containers, subflow ──

test("router executes only the matching branch (golden G4)", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      {
        id: "route",
        type: "router",
        branches: [
          {
            id: "b1", label: "Big", condition: { op: "eq", left: "{{trigger.n}}", right: 1 },
            steps: [{ id: "big_step", type: "http", props: { method: "GET", url: "https://example.com" } }],
          },
          {
            id: "b2", label: "Small", default: true,
            steps: [{ id: "small_step", type: "http", props: { method: "GET", url: "https://example.com" } }],
          },
        ],
      } as any,
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def);
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async (ctx) => ({ kind: "ok" as const, output: { ran: ctx.step.id } }) }],
  ]);
  const ex = new Executor(db, queues, handlers);
  await ex.transition("run1", 0, 1);
  assert.equal(state.status, "succeeded");
  const routeOut = state.context.route as { branchId?: string; big_step?: unknown } | undefined;
  assert.equal(routeOut?.branchId, "b1", "router records the selected branch");
  assert.deepEqual(routeOut?.big_step, { ran: "big_step" }, "matching branch must run");
  assert.equal((routeOut as Record<string, unknown>).small_step, undefined, "non-matching branch must not run");
});

test("loop with concurrency executes every item (golden G5)", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      {
        id: "iter",
        type: "loop",
        props: { items: "{{trigger.items}}", concurrency: 4 },
        steps: [{ id: "work", type: "http", props: { method: "GET", url: "https://example.com" } }],
      } as any,
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def, { trigger: { items: [1, 2, 3, 4, 5] } });
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async () => ({ kind: "ok" as const, output: {} }) }],
  ]);
  const ex = new Executor(db, queues, handlers);
  await ex.transition("run1", 0, 1);
  assert.equal(state.status, "succeeded");
  const loopOut = state.context.iter as { items?: unknown[]; count?: number } | undefined;
  assert.ok(loopOut, "loop step must persist an output");
  assert.equal(loopOut?.count, 5, "loop reports the item count");
  assert.equal(Array.isArray(loopOut?.items) ? loopOut!.items!.length : -1, 5, "every loop item must produce a result");
});

test("nested branch inside loop executes (golden G5 nesting)", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      {
        id: "outer",
        type: "loop",
        props: { items: "{{trigger.items}}", concurrency: 1 },
        steps: [
          {
            id: "inner_br",
            type: "branch",
            condition: { op: "eq", left: "{{item}}", right: 1 },
            onTrue: [{ id: "leaf", type: "http", props: { method: "GET", url: "https://example.com" } }],
            onFalse: [],
          } as any,
        ],
      } as any,
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def, { trigger: { items: [1, 2] } });
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async () => ({ kind: "ok" as const, output: { leafRan: true } }) }],
  ]);
  const ex = new Executor(db, queues, handlers);
  await ex.transition("run1", 0, 1);
  assert.equal(state.status, "succeeded", "nested branch inside loop must not throw");
});

test("subflow self-reference fails fast with SUBFLOW_RECURSION (golden G8 guard)", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      {
        id: "child",
        type: "sub_flow",
        props: { flowId: "11111111-1111-1111-1111-111111111111", input: {}, waitForCompletion: true },
      } as any,
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def);
  // Simulate the run itself belonging to that flow, making the call self-referential.
  db.flowRuns.claimTransition = async () => ({
    id: "run1", orgId: "org1", flowVersionId: "v1",
    contextJson: { trigger: { n: 1 } }, transitionEpoch: 1, createdAt: new Date().toISOString(),
    flowId: "11111111-1111-1111-1111-111111111111",
  });
  db.flowVersions.currentPublished = async (_flowId: string) => ({ id: "v-child", definition: def });
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async () => ({ kind: "ok" as const, output: {} }) }],
  ]);
  const ex = new Executor(db, queues, handlers);
  await ex.transition("run1", 0, 1);
  assert.equal(state.status, "failed", "self-referential subflow must fail, not loop forever");
});

test("aggregator merges branch outputs into one step output (fan_in)", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      { id: "a", type: "http", props: { method: "GET", url: "https://example.com/a" } },
      { id: "b", type: "http", props: { method: "GET", url: "https://example.com/b" } },
      {
        id: "fan_in",
        type: "aggregator",
        props: { sources: ["a", "b"], mode: "merge" },
      },
      { id: "after", type: "http", props: { method: "GET", url: "https://example.com/after" } },
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def);
  let afterContext: Record<string, unknown> = {};
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async (ctx) => { afterContext = { ...ctx.context }; return { kind: "ok" as const, output: { ran: true } }; } }],
  ]);
  const ex = new Executor(db, queues, handlers);
  // Drive the sequential cursors manually (mock queue does not re-enter).
  await ex.transition("run1", 0, 1); // a
  await ex.transition("run1", 1, 2); // b
  await ex.transition("run1", 2, 3); // aggregator
  await ex.transition("run1", 3, 4); // after
  assert.equal(state.status, "succeeded");
  // The step after the aggregator sees merged outputs + bookkeeping keys.
  const agg = afterContext["fan_in"] as Record<string, unknown>;
  assert.ok(agg, "aggregator output present in downstream context");
  assert.deepEqual(agg.missing, [], "no missing sources when both branches ran");
  assert.deepEqual((agg.sources as Record<string, unknown>)["a"], { ran: true });
});

test("aggregator collect mode gathers items and reports missing sources", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      { id: "only", type: "http", props: { method: "GET", url: "https://example.com" } },
      {
        id: "fan_in",
        type: "aggregator",
        props: { sources: ["only", "never-ran"], mode: "collect", separator: ", " },
      },
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def);
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async () => ({ kind: "ok" as const, output: { id: 7 } }) }],
  ]);
  const ex = new Executor(db, queues, handlers);
  await ex.transition("run1", 0, 1);
  await ex.transition("run1", 1, 2);
  assert.equal(state.status, "succeeded");
  const ctx = state.context as Record<string, Record<string, unknown>>;
  const agg = ctx["fan_in"];
  assert.equal(agg.count, 1);
  assert.deepEqual(agg.items, [{ id: 7 }]);
  assert.equal(agg.text, JSON.stringify({ id: 7 }));
  assert.deepEqual(agg.missing, ["never-ran"]);
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

// ── Golden G7: durable delay → resume completes the run AFTER the delay ────
test("golden G7: delay resumes once and completes downstream steps (no re-pause loop)", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      { id: "a", type: "http", props: { method: "GET", url: "https://example.com/a" } },
      { id: "wait", type: "delay", props: { mode: "duration", seconds: 30 } as any },
      { id: "b", type: "http", props: { method: "GET", url: "https://example.com/b" } },
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def);
  // Cursor is engine-managed in this mock: pause() persists nextCursor,
  // resumeClaim() flips paused→running and returns the stored cursor, and
  // claimTransition is permissive about epoch (real dedupe is modeled by the
  // paused flag in resumeClaim — the actual first-claimer-wins mechanism).
  let storedCursor = 0;
  db.flowRuns.claimTransition = async (_runId: string, _expectedCursor: number, expectedEpoch: number) => ({
    id: "run1", orgId: "org1", flowVersionId: "v1", contextJson: state.context,
    transitionEpoch: expectedEpoch, createdAt: new Date().toISOString(),
  });
  db.flowRuns.pause = async (_runId: string, input: any) => { storedCursor = input.nextCursor ?? input.expectedCursor + 1; (state as any).paused = true; };
  db.flowRuns.resumeClaim = async () => {
    if ((state as any).paused !== true) return null;
    (state as any).paused = false;
    return { id: "run1", orgId: "org1", flowVersionId: "v1", contextJson: state.context, transitionEpoch: 9, createdAt: new Date().toISOString(), cursor: storedCursor };
  };
  const executed: string[] = [];
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async ({ step }) => { executed.push(step.id); return { kind: "ok" as const, output: { ran: step.id } }; } }],
  ]);
  const ex = new Executor(db, queues, handlers);
  await ex.transition("run1", 0, 1); // a
  await ex.transition("run1", 1, 2); // wait → pause
  assert.equal((state as any).paused, true);
  await ex.resume("run1"); // continues AFTER the delay
  assert.equal(state.status, "succeeded");
  assert.deepEqual(executed, ["a", "b"], "delay must not re-execute on resume");
});

// ── Golden G8: approval resume continues after the step, exactly once ──────
test("golden G8: approval resume continues after the step and duplicate resumes are no-ops", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      { id: "ask", type: "approval", props: { title: "Sign off", timeoutHours: 24 } },
      { id: "after", type: "http", props: { method: "GET", url: "https://example.com/after" } },
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def);
  const todos: any[] = [];
  db.todos.create = async (...args: any[]) => { todos.push(args); return { id: "todo1" }; };
  let storedCursor = 0;
  db.flowRuns.claimTransition = async (_runId: string, _expectedCursor: number, expectedEpoch: number) => ({
    id: "run1", orgId: "org1", flowVersionId: "v1", contextJson: state.context,
    transitionEpoch: expectedEpoch, createdAt: new Date().toISOString(),
  });
  db.flowRuns.pause = async (_runId: string, input: any) => { storedCursor = input.nextCursor ?? input.expectedCursor + 1; (state as any).paused = true; };
  db.flowRuns.resumeClaim = async () => {
    if ((state as any).paused !== true) return null; // first claimer wins
    (state as any).paused = false;
    return { id: "run1", orgId: "org1", flowVersionId: "v1", contextJson: state.context, transitionEpoch: 9, createdAt: new Date().toISOString(), cursor: storedCursor };
  };
  let afterRuns = 0;
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async () => { afterRuns += 1; return { kind: "ok" as const, output: {} }; } }],
  ]);
  const ex = new Executor(db, queues, handlers);
  await ex.transition("run1", 0, 1); // approval pauses (todo created once)
  assert.equal((state as any).paused, true);
  assert.equal(todos.length, 1, "exactly one approval todo on pause");
  // Two resume attempts race (user approval + sweeper) — only one may win.
  await Promise.all([ex.resume("run1"), ex.resume("run1")]);
  await ex.resume("run1"); // a late third resume after completion
  assert.equal(state.status, "succeeded");
  assert.equal(afterRuns, 1, "downstream step must run exactly once");
  assert.equal(todos.length, 1, "resume must not re-create the approval todo");
});

// ── Golden G6: onError = fallbackValue keeps the run green ─────────────────
test("golden G6: step failure with fallbackValue yields the fallback output and completes", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      { id: "flaky", type: "http", onError: "fallback", fallbackValue: { degraded: true }, props: { method: "GET", url: "https://example.com" } },
      { id: "next", type: "http", props: { method: "GET", url: "https://example.com/next" } },
    ],
    settings: { timezone: "UTC" },
  } as any);
  const { state, db, queues } = createMockDb(def);
  let nextContext: Record<string, unknown> = {};
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async (ctx) => ctx.step.id === "flaky" ? { kind: "error" as const, error: new EngineError("transient", "RATE_LIMITED", "429") } : { kind: "ok" as const, output: {} } }],
  ]);
  // Capture the downstream context by observing the final run context.
  const ex = new Executor(db, queues, handlers);
  await ex.transition("run1", 0, 1);
  await ex.transition("run1", 1, 2);
  assert.equal(state.status, "succeeded", "fallback policy must not fail the run");
  const flaky = (state.context as Record<string, any>)["flaky"];
  assert.deepEqual(flaky, { degraded: true }, "step output must be the configured fallbackValue");
});

// ── Full sequential certification: trigger → action → action → done ────────
test("golden: full sequential run persists every step and finishes succeeded", async () => {
  const def = parseFlowDefinition({
    schemaVersion: 1,
    trigger: { id: "trigger", type: "manual", props: {} },
    steps: [
      { id: "s1", type: "http", props: { method: "GET", url: "https://example.com/1" } },
      { id: "s2", type: "http", props: { method: "GET", url: "https://example.com/2" } },
    ],
    settings: { timezone: "UTC" },
  });
  const { state, db, queues } = createMockDb(def);
  const recorded: Array<{ stepId: string; status: string }> = [];
  db.runSteps.insert = async (input: any) => { recorded.push({ stepId: input.stepId, status: input.status }); };
  const handlers = new Map<string, StepHandler>([
    ["http", { execute: async ({ step }) => ({ kind: "ok" as const, output: { n: step.id } }) }],
  ]);
  const ex = new Executor(db, queues, handlers);
  await ex.transition("run1", 0, 1);
  await ex.transition("run1", 1, 2);
  assert.equal(state.status, "succeeded");
  assert.deepEqual(recorded, [
    { stepId: "s1", status: "succeeded" },
    { stepId: "s2", status: "succeeded" },
  ], "every step outcome must be persisted in order");
});
