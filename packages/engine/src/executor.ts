import { evaluateFlowCondition, resolveValue, type TFlowDefinition, type Step } from "@algoverge/core";

export type ErrorClass = "auth" | "validation" | "transient" | "fatal" | "budget";
export class EngineError extends Error {
  constructor(public readonly errorClass: ErrorClass, public readonly code: string, message?: string) { super(message ?? code); this.name = "EngineError"; }
  static from(error: unknown): EngineError {
    if (error instanceof EngineError) return error;
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized")) return new EngineError("auth", "AUTH_FAILED", error.message);
      if (msg.includes("429") || msg.includes("rate limit")) return new EngineError("transient", "RATE_LIMITED", error.message);
      if (msg.includes("timeout")) return new EngineError("transient", "TIMEOUT", error.message);
      if (msg.includes("budget")) return new EngineError("budget", "BUDGET_EXCEEDED", error.message);
      return new EngineError("fatal", "FATAL", error.message);
    }
    return new EngineError("fatal", "UNKNOWN", String(error));
  }
}

type Outcome = { kind: "ok"; output: Record<string, unknown> } | { kind: "error"; error: EngineError } | { kind: "stop" } | { kind: "pause"; reason: string; resumeAt?: string };
export interface StepHandler { execute(ctx: { run: { id: string; orgId: string; mode?: string }; step: Step; props: Record<string, unknown>; context: Readonly<Record<string, unknown>>; attempt: number; idempotencyKey: string }): Promise<Outcome>; }

function resolveProps(props: Record<string, unknown>, context: Record<string, unknown>): Record<string, unknown> { const result: Record<string, unknown> = {}; for (const [key, value] of Object.entries(props)) result[key] = resolveValue(value, context); return result; }
function stepTimeout(step: Step): number { const props = (step as Record<string, unknown>).props as Record<string, unknown> | undefined; return props?.timeoutMs ? Number(props.timeoutMs) : 30_000; }
function backoff(attempt: number): number { return Math.min(1000 * Math.pow(2, attempt - 1), 60_000) + Math.random() * 1000; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

export class Executor {
  constructor(private readonly db: any, private readonly queues: any, private readonly handlers: Map<string, StepHandler>) {}

  async transition(runId: string, cursor: number, epoch: number): Promise<void> {
    const run = await this.db.flowRuns.claimTransition(runId, cursor, epoch); if (!run) return;
    const version = await this.db.flowVersions.byId(run.flowVersionId); if (!version) throw new EngineError("fatal", "FLOW_VERSION_NOT_FOUND");
    const definition = version.definition as TFlowDefinition; const steps = definition.steps;
    if (cursor >= steps.length) return this.finish(run.id, "succeeded", run.contextJson);
    const step = steps[cursor]; const context = run.contextJson as Record<string, unknown>;
    if (step.type === "filter") { if (!evaluateFlowCondition(step.condition as any, context)) return this.finish(run.id, "filtered", context); return this.advance(run, cursor, { [step.id]: { passed: true } }); }
    if (step.type === "branch" || step.type === "router" || step.type === "sub_flow") return this.executeContainer(run, definition, step, cursor, context);
    if (step.type === "loop") return this.executeLoop(run, definition, step as any, cursor, context);
    if (step.type === "note") return this.advance(run, cursor, { [step.id]: { noted: true } });
    if (step.type === "delay") return this.pause(run, cursor, context, { kind: "pause", reason: "delay", resumeAt: (step as any).props?.untilIso });
    if (step.type === "approval") { const props = (step as any).props || {}; await this.db.todos.create(run.orgId, run.id, run.createdAt, step.id, props.title || "Approval needed", { ...props.editableFields }); return this.pause(run, cursor, context, { kind: "pause", reason: "approval" }); }
    const props = resolveProps((step as Record<string, unknown>).props as Record<string, unknown> ?? {}, context);
    const result = await this.executeLeaf(run, step, props, context);
    if (result.kind === "ok") return this.advance(run, cursor, { [step.id]: result.output });
    if (result.kind === "stop") return this.finish(run.id, "filtered", context);
    if (result.kind === "pause") return this.pause(run, cursor, context, result);
    return this.applyErrorPolicy(run, definition, step, cursor, context, result.error);
  }

  private async executeLeaf(run: { id: string; orgId: string }, step: Step, props: Record<string, unknown>, context: Record<string, unknown>): Promise<Outcome> {
    const handler = this.handlers.get(step.type); if (!handler) return { kind: "error", error: new EngineError("fatal", "NO_HANDLER") };
    const retry = (step as any).retry?.maxAttempts ?? 3; let last: Outcome = { kind: "error", error: new EngineError("fatal", "NO_ATTEMPT") };
    for (let attempt = 1; attempt <= retry; attempt += 1) {
      const started = Date.now(); const key = `${run.id}:${step.id}:effect`;
      const completed = await this.db.runSteps.completedByEffectKey(run.id, step.id, key); if (completed) return { kind: "ok", output: completed.outputJson ?? {} };
      try { last = await Promise.race([handler.execute({ run, step, props, context: Object.freeze({ ...context }), attempt, idempotencyKey: key }), new Promise<Outcome>((_, reject) => setTimeout(() => reject(new EngineError("transient", "TIMEOUT")), stepTimeout(step)))]); }
      catch (error) { last = { kind: "error", error: EngineError.from(error) }; }
      await this.record(run.id, step, props, last, Date.now() - started, attempt, key);
      if (last.kind !== "error" || last.error.errorClass !== "transient" || attempt === retry) return last;
      await sleep(backoff(attempt));
    }
    return last;
  }

  private async executeContainer(run: { id: string; orgId: string; contextJson?: unknown }, definition: TFlowDefinition, step: Step, cursor: number, context: Record<string, unknown>): Promise<void> {
    if (step.type === "branch") { const selected = evaluateFlowCondition(step.condition as any, context) ? step.onTrue : step.onFalse; return this.advance(run, cursor, { [step.id]: await this.runInline(run, definition, selected as Step[], context) }); }
    if (step.type === "router") { const branches = (step as any).branches; const selected = branches.find((b: any) => b.condition && evaluateFlowCondition(b.condition, context)) ?? branches.find((b: any) => b.default); const output = selected ? await this.runInline(run, definition, selected.steps, context) : {}; return this.advance(run, cursor, { [step.id]: { branchId: selected?.id ?? null, ...output } }); }
    return this.advance(run, cursor, {});
  }

  private async executeLoop(run: { id: string; orgId: string; transitionEpoch?: number }, definition: TFlowDefinition, step: any, cursor: number, context: Record<string, unknown>): Promise<void> {
    const props = resolveProps(step.props ?? {}, context); const items = props.items; if (!Array.isArray(items)) throw new EngineError("validation", "PROP_TYPE_MISMATCH");
    const outputs: unknown[] = new Array(items.length); for (let i = 0; i < items.length; i++) outputs[i] = await this.runInline(run, definition, step.steps, { ...context, loop: { item: items[i], index: i, total: items.length } });
    await this.advance(run, cursor, { [step.id]: { items: outputs, count: items.length } });
  }

  private async runInline(run: { id: string; orgId: string; transitionEpoch?: number }, definition: TFlowDefinition, steps: Step[], context: Record<string, unknown>): Promise<Record<string, unknown>> {
    let appended: Record<string, unknown> = {};
    for (const child of steps) {
      if (child.type === "filter" && !evaluateFlowCondition(child.condition as any, { ...context, ...appended })) break;
      if (child.type !== "filter") { const props = resolveProps((child as any).props ?? {}, { ...context, ...appended }); const result = await this.executeLeaf(run, child, props, { ...context, ...appended }); if (result.kind !== "ok") throw new EngineError("fatal", `INLINE_${result.kind.toUpperCase()}`); appended = { ...appended, [child.id]: result.output }; }
    }
    return appended;
  }

  private async advance(run: { id: string; orgId: string; transitionEpoch?: number }, cursor: number, append: Record<string, unknown>): Promise<void> {
    const state = await this.db.flowRuns.checkpoint(run.id, { expectedCursor: cursor, expectedEpoch: run.transitionEpoch, appendContext: append, nextCursor: cursor + 1, status: "queued" });
    await this.queues.flowStep.add("transition", { runId: run.id, orgId: run.orgId, cursor: state.cursor, epoch: state.transitionEpoch }, { jobId: `step:${run.id}:${state.cursor}:${state.transitionEpoch}` });
  }

  private async pause(run: { id: string; transitionEpoch?: number }, cursor: number, context: Record<string, unknown>, outcome: { kind?: string; reason: string; resumeAt?: string }): Promise<void> { await this.db.flowRuns.pause(run.id, { expectedCursor: cursor, expectedEpoch: run.transitionEpoch ?? 1, contextJson: context, reason: outcome.reason, resumeAt: outcome.resumeAt ?? null }); }

  private async applyErrorPolicy(run: { id: string }, definition: TFlowDefinition, step: Step, cursor: number, context: Record<string, unknown>, error: EngineError): Promise<void> {
    const policy = (step as any).onError ?? "fail";
    if (policy === "continue") return this.advance(run as any, cursor, { [step.id]: { error: { message: error.message, code: error.code } } });
    return this.finish(run.id, "failed", { ...context, [step.id]: { error: { message: error.message, code: error.code } } });
  }

  private async record(runId: string, step: Step, input: unknown, outcome: Outcome, durationMs: number, attempt: number, effectKey: string): Promise<void> {
    const output = outcome.kind === "ok" ? outcome.output : null;
    await this.db.runSteps.insert({ runId, runCreatedAt: "", orgId: "", stepId: step.id, stepType: step.type, effectKey, status: outcome.kind === "ok" ? "succeeded" : "failed", inputJson: input as Record<string, unknown>, outputJson: output ?? undefined, errorClass: outcome.kind === "error" ? outcome.error.errorClass : undefined, errorCode: outcome.kind === "error" ? outcome.error.code : undefined, attempt, durationMs });
  }
  private async finish(runId: string, status: string, context: unknown): Promise<void> { await this.db.flowRuns.finish(runId, status, context, new Date()); }
}
