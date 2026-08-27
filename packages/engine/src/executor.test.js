"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const core_1 = require("@algoverge/core");
const executor_1 = require("./executor");
// ── Test helpers ────────────────────────────────────────────────────────────
function createMockDb(def, context = { trigger: { n: 1 } }) {
    let runStatus = "queued";
    let runContext = { ...context };
    let transitionEpoch = 1;
    const state = {
        get status() { return runStatus; },
        get context() { return runContext; },
    };
    const db = {
        flowRuns: {
            async claimTransition(_runId, _expectedCursor, expectedEpoch) {
                if (transitionEpoch !== expectedEpoch)
                    return null;
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
            async checkpoint(_runId, input) {
                Object.assign(runContext, input.appendContext);
                runStatus = input.status;
                return { cursor: input.nextCursor, transitionEpoch: input.expectedEpoch + 1 };
            },
            async finish(_runId, status, context) {
                runStatus = status;
                runContext = context;
            },
            async pause(_runId, _input) {
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
            async completedByEffectKey(_runId, _stepId, _key) { return null; },
            async insert() { },
        },
    };
    const queues = {
        flowStep: {
            async add() { return { id: "job1" }; },
        },
    };
    return { state, db, queues };
}
// ── Tests ───────────────────────────────────────────────────────────────────
(0, node_test_1.default)("filter halt does not run later steps", async () => {
    const def = (0, core_1.parseFlowDefinition)({
        schemaVersion: 1,
        trigger: { id: "trigger", type: "manual", props: {} },
        steps: [
            { id: "keep", type: "filter", condition: { op: "eq", left: "{{trigger.n}}", right: 2 } },
            { id: "http_1", type: "http", props: { method: "GET", url: "https://example.com" } },
        ],
        settings: { timezone: "UTC" },
    });
    const { state, db, queues } = createMockDb(def);
    const handlers = new Map([
        ["http", { execute: async () => ({ kind: "ok", output: { ran: true } }) }],
    ]);
    const ex = new executor_1.Executor(db, queues, handlers);
    await ex.transition("run1", 0, 1);
    strict_1.default.equal(state.status, "filtered");
    strict_1.default.equal(state.context.http_1, undefined);
});
(0, node_test_1.default)("branch walks onTrue and records leaf output", async () => {
    const def = (0, core_1.parseFlowDefinition)({
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
    const handlers = new Map([
        ["http", { execute: async () => ({ kind: "ok", output: { ok: true } }) }],
    ]);
    const ex = new executor_1.Executor(db, queues, handlers);
    await ex.transition("run1", 0, 1);
    strict_1.default.equal(state.status, "succeeded");
    strict_1.default.deepEqual(state.context.ok_step, { ok: true });
});
(0, node_test_1.default)("transient handler errors retry then succeed", async () => {
    const def = (0, core_1.parseFlowDefinition)({
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
    const handlers = new Map([
        ["http", {
                execute: async () => {
                    n += 1;
                    if (n < 2)
                        throw new Error("timeout");
                    return { kind: "ok", output: { n } };
                },
            }],
    ]);
    const ex = new executor_1.Executor(db, queues, handlers);
    await ex.transition("run1", 0, 1);
    strict_1.default.equal(state.status, "succeeded");
    strict_1.default.equal(n, 2);
});
