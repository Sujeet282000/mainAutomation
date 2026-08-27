"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Executor = exports.EngineError = void 0;
const core_1 = require("@algoverge/core");
class EngineError extends Error {
    errorClass;
    code;
    constructor(errorClass, code, message) {
        super(message ?? code);
        this.errorClass = errorClass;
        this.code = code;
        this.name = "EngineError";
    }
    static from(error) {
        if (error instanceof EngineError)
            return error;
        if (error instanceof Error) {
            const msg = error.message.toLowerCase();
            if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized"))
                return new EngineError("auth", "AUTH_FAILED", error.message);
            if (msg.includes("429") || msg.includes("rate limit"))
                return new EngineError("transient", "RATE_LIMITED", error.message);
            if (msg.includes("timeout"))
                return new EngineError("transient", "TIMEOUT", error.message);
            if (msg.includes("budget"))
                return new EngineError("budget", "BUDGET_EXCEEDED", error.message);
            return new EngineError("fatal", "FATAL", error.message);
        }
        return new EngineError("fatal", "UNKNOWN", String(error));
    }
}
exports.EngineError = EngineError;
function resolveProps(props, context) { const result = {}; for (const [key, value] of Object.entries(props))
    result[key] = (0, core_1.resolveValue)(value, context); return result; }
function stepTimeout(step) { const props = step.props; return props?.timeoutMs ? Number(props.timeoutMs) : 30_000; }
function backoff(attempt) { return Math.min(1000 * Math.pow(2, attempt - 1), 60_000) + Math.random() * 1000; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
class Executor {
    db;
    queues;
    handlers;
    constructor(db, queues, handlers) {
        this.db = db;
        this.queues = queues;
        this.handlers = handlers;
    }
    async transition(runId, cursor, epoch) {
        const run = await this.db.flowRuns.claimTransition(runId, cursor, epoch);
        if (!run)
            return;
        const version = await this.db.flowVersions.byId(run.flowVersionId);
        if (!version)
            throw new EngineError("fatal", "FLOW_VERSION_NOT_FOUND");
        const definition = version.definition;
        const steps = definition.steps;
        if (cursor >= steps.length)
            return this.finish(run.id, "succeeded", run.contextJson);
        const step = steps[cursor];
        const context = run.contextJson;
        if (step.type === "filter") {
            if (!(0, core_1.evaluateFlowCondition)(step.condition, context))
                return this.finish(run.id, "filtered", context);
            return this.advance(run, cursor, { [step.id]: { passed: true } }, steps.length);
        }
        if (step.type === "branch" || step.type === "router" || step.type === "sub_flow")
            return this.executeContainer(run, definition, step, cursor, context);
        if (step.type === "loop")
            return this.executeLoop(run, definition, step, cursor, context);
        if (step.type === "note")
            return this.advance(run, cursor, { [step.id]: { noted: true } }, steps.length);
        if (step.type === "delay")
            return this.pause(run, cursor, context, { kind: "pause", reason: "delay", resumeAt: step.props?.untilIso });
        if (step.type === "approval") {
            const props = step.props || {};
            await this.db.todos.create(run.orgId, run.id, run.createdAt, step.id, props.title || "Approval needed", { ...props.editableFields });
            return this.pause(run, cursor, context, { kind: "pause", reason: "approval" });
        }
        const props = resolveProps(step.props ?? {}, context);
        const result = await this.executeLeaf(run, step, props, context);
        if (result.kind === "ok")
            return this.advance(run, cursor, { [step.id]: result.output }, steps.length);
        if (result.kind === "stop")
            return this.finish(run.id, "filtered", context);
        if (result.kind === "pause")
            return this.pause(run, cursor, context, result);
        return this.applyErrorPolicy(run, definition, step, cursor, context, result.error);
    }
    async executeLeaf(run, step, props, context) {
        const handler = this.handlers.get(step.type);
        if (!handler)
            return { kind: "error", error: new EngineError("fatal", "NO_HANDLER") };
        const retry = step.retry?.maxAttempts ?? 3;
        let last = { kind: "error", error: new EngineError("fatal", "NO_ATTEMPT") };
        for (let attempt = 1; attempt <= retry; attempt += 1) {
            const started = Date.now();
            const key = `${run.id}:${step.id}:effect`;
            const completed = await this.db.runSteps.completedByEffectKey(run.id, step.id, key);
            if (completed)
                return { kind: "ok", output: completed.outputJson ?? {} };
            try {
                last = await Promise.race([handler.execute({ run, step, props, context: Object.freeze({ ...context }), attempt, idempotencyKey: key }), new Promise((_, reject) => setTimeout(() => reject(new EngineError("transient", "TIMEOUT")), stepTimeout(step)))]);
            }
            catch (error) {
                last = { kind: "error", error: EngineError.from(error) };
            }
            await this.record(run.id, step, props, last, Date.now() - started, attempt, key);
            if (last.kind !== "error" || last.error.errorClass !== "transient" || attempt === retry)
                return last;
            await sleep(backoff(attempt));
        }
        return last;
    }
    async executeContainer(run, definition, step, cursor, context) {
        const totalSteps = definition.steps.length;
        if (step.type === "branch") {
            const selected = (0, core_1.evaluateFlowCondition)(step.condition, context) ? step.onTrue : step.onFalse;
            const inline = await this.runInline(run, definition, selected, context);
            return this.advance(run, cursor, inline, totalSteps);
        }
        if (step.type === "router") {
            const branches = step.branches;
            const selected = branches.find((b) => b.condition && (0, core_1.evaluateFlowCondition)(b.condition, context)) ?? branches.find((b) => b.default);
            const output = selected ? await this.runInline(run, definition, selected.steps, context) : {};
            return this.advance(run, cursor, { [step.id]: { branchId: selected?.id ?? null, ...output } }, totalSteps);
        }
        return this.advance(run, cursor, {}, totalSteps);
    }
    async executeLoop(run, definition, step, cursor, context) {
        const props = resolveProps(step.props ?? {}, context);
        const items = props.items;
        if (!Array.isArray(items))
            throw new EngineError("validation", "PROP_TYPE_MISMATCH");
        const outputs = new Array(items.length);
        for (let i = 0; i < items.length; i++)
            outputs[i] = await this.runInline(run, definition, step.steps, { ...context, loop: { item: items[i], index: i, total: items.length } });
        await this.advance(run, cursor, { [step.id]: { items: outputs, count: items.length } }, definition.steps.length);
    }
    async runInline(run, definition, steps, context) {
        let appended = {};
        for (const child of steps) {
            if (child.type === "filter" && !(0, core_1.evaluateFlowCondition)(child.condition, { ...context, ...appended }))
                break;
            if (child.type !== "filter") {
                const props = resolveProps(child.props ?? {}, { ...context, ...appended });
                const result = await this.executeLeaf(run, child, props, { ...context, ...appended });
                if (result.kind !== "ok")
                    throw new EngineError("fatal", `INLINE_${result.kind.toUpperCase()}`);
                appended = { ...appended, [child.id]: result.output };
            }
        }
        return appended;
    }
    async advance(run, cursor, append, totalSteps) {
        if (cursor + 1 >= totalSteps)
            return this.finish(run.id, "succeeded", { ...(run.contextJson ?? {}), ...append });
        const state = await this.db.flowRuns.checkpoint(run.id, { expectedCursor: cursor, expectedEpoch: run.transitionEpoch, appendContext: append, nextCursor: cursor + 1, status: "queued" });
        await this.queues.flowStep.add("transition", { runId: run.id, orgId: run.orgId, cursor: state.cursor, epoch: state.transitionEpoch }, { jobId: `step:${run.id}:${state.cursor}:${state.transitionEpoch}` });
    }
    async pause(run, cursor, context, outcome) { await this.db.flowRuns.pause(run.id, { expectedCursor: cursor, expectedEpoch: run.transitionEpoch ?? 1, contextJson: context, reason: outcome.reason, resumeAt: outcome.resumeAt ?? null }); }
    async applyErrorPolicy(run, definition, step, cursor, context, error) {
        const policy = step.onError ?? "fail";
        if (policy === "continue")
            return this.advance(run, cursor, { [step.id]: { error: { message: error.message, code: error.code } } }, definition.steps.length);
        return this.finish(run.id, "failed", { ...context, [step.id]: { error: { message: error.message, code: error.code } } });
    }
    async record(runId, step, input, outcome, durationMs, attempt, effectKey) {
        const output = outcome.kind === "ok" ? outcome.output : null;
        await this.db.runSteps.insert({ runId, runCreatedAt: "", orgId: "", stepId: step.id, stepType: step.type, effectKey, status: outcome.kind === "ok" ? "succeeded" : "failed", inputJson: input, outputJson: output ?? undefined, errorClass: outcome.kind === "error" ? outcome.error.errorClass : undefined, errorCode: outcome.kind === "error" ? outcome.error.code : undefined, attempt, durationMs });
    }
    async finish(runId, status, context) { await this.db.flowRuns.finish(runId, status, context, new Date()); }
}
exports.Executor = Executor;
