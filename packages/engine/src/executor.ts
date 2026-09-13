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
export interface StepHandler { execute(ctx: { run: { id: string; orgId: string; createdAt?: string; mode?: string }; step: Step; props: Record<string, unknown>; context: Readonly<Record<string, unknown>>; attempt: number; idempotencyKey: string }): Promise<Outcome>; }

function resolveProps(props: Record<string, unknown>, context: Record<string, unknown>): Record<string, unknown> { const result: Record<string, unknown> = {}; for (const [key, value] of Object.entries(props)) result[key] = resolveValue(value, context); return result; }
function stepTimeout(step: Step): number { const props = (step as Record<string, unknown>).props as Record<string, unknown> | undefined; return props?.timeoutMs ? Number(props.timeoutMs) : 30_000; }
const DEFAULT_RETRY = { maxAttempts: 3, backoff: "exponential" as "fixed" | "exponential", initialDelayMs: 1_000, maxDelayMs: 60_000, retryOn: ["transient" as const] };
function retryPolicy(step: Step): typeof DEFAULT_RETRY {
  const raw = (step as Record<string, unknown>).retry as Partial<typeof DEFAULT_RETRY> | undefined;
  if (!raw) return DEFAULT_RETRY;
  return { maxAttempts: Number(raw.maxAttempts ?? DEFAULT_RETRY.maxAttempts), backoff: raw.backoff === "fixed" ? "fixed" : "exponential", initialDelayMs: Number(raw.initialDelayMs ?? DEFAULT_RETRY.initialDelayMs), maxDelayMs: Number(raw.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs), retryOn: Array.isArray(raw.retryOn) && raw.retryOn.length ? raw.retryOn : DEFAULT_RETRY.retryOn };
}
function backoff(attempt: number, policy: { backoff: "fixed" | "exponential"; initialDelayMs: number; maxDelayMs: number }): number { const base = policy.backoff === "fixed" ? policy.initialDelayMs : Math.min(policy.initialDelayMs * Math.pow(2, attempt - 1), policy.maxDelayMs); return Math.min(base, policy.maxDelayMs) + Math.random() * 250; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

export function aggregateOutput(sources: string[], mode: string | undefined, separator: string | undefined, context: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const outputs = sources.map((id) => (context[id] as Record<string, unknown> | undefined) ?? null);
  const present = sources.filter((id) => context[id] !== undefined);
  if (mode === "collect") { const items = outputs.filter((o) => o !== null); const sep = separator ?? "\n"; return { items, count: items.length, text: items.map((o) => typeof o === "string" ? o : JSON.stringify(o)).join(sep), missing: sources.filter((id) => context[id] === undefined) }; }
  const merged: Record<string, unknown> = {}; for (const o of outputs) if (o && typeof o === "object") Object.assign(merged, o);
  return { ...merged, sources: Object.fromEntries(present.map((id, i) => [id, outputs[i]])), missing: sources.filter((id) => context[id] === undefined) };
}

const MAX_INLINE_DEPTH = 16;
type EngineRun = { id: string; orgId: string; createdAt?: string; flowId?: string; projectId?: string; contextJson?: Record<string, unknown>; transitionEpoch?: number; mode?: string };

export class Executor {
  constructor(private readonly db: any, private readonly queues: any, private readonly handlers: Map<string, StepHandler>) {}

  async transition(runId: string, cursor: number, epoch: number): Promise<void> {
    const run = await this.db.flowRuns.claimTransition(runId, cursor, epoch); if (!run) return;
    const version = await this.db.flowVersions.byId(run.flowVersionId); if (!version) throw new EngineError("fatal", "FLOW_VERSION_NOT_FOUND");
    const definition = version.definition as TFlowDefinition; const steps = definition.steps;
    const context = (run.contextJson ?? {}) as Record<string, unknown>;
    if (cursor >= steps.length) return this.finish(run.id, "succeeded", context);
    const step = steps[cursor];

    // Replay-from-step: outputs recorded before the replay point are copied into
    // the new run context and never re-execute their side effects.
    const replay = context.__replaySteps as Record<string, Record<string, unknown>> | undefined;
    if (replay && Object.prototype.hasOwnProperty.call(replay, step.id)) {
      return this.advance(run, cursor, { [step.id]: replay[step.id] }, steps.length);
    }

    if (step.type === "filter") { if (!evaluateFlowCondition(step.condition as any, context)) return this.finish(run.id, "filtered", context); return this.advance(run, cursor, { [step.id]: { passed: true } }, steps.length); }
    if (step.type === "branch" || step.type === "router") return this.executeContainer(run, definition, step, cursor, context);
    if (step.type === "sub_flow") return this.executeSubFlow(run, definition, step as any, cursor, context);
    if (step.type === "aggregator") return this.executeAggregator(run, definition, step as any, cursor, context);
    if (step.type === "loop") return this.executeLoop(run, definition, step as any, cursor, context);
    if (step.type === "note") return this.advance(run, cursor, { [step.id]: { noted: true } }, steps.length);
    if (step.type === "delay") return this.executeDelay(run, cursor, context, step as any);
    if (step.type === "approval") return this.executeApproval(run, cursor, context, step as any);
    const props = resolveProps((step as Record<string, unknown>).props as Record<string, unknown> ?? {}, context);
    const result = await this.executeLeaf(run, step, props, context);
    if (result.kind === "ok") return this.advance(run, cursor, { [step.id]: result.output }, steps.length);
    if (result.kind === "stop") return this.finish(run.id, "filtered", context);
    if (result.kind === "pause") return this.pause(run, cursor, context, result);
    return this.applyErrorPolicy(run, definition, step, cursor, context, result.error);
  }

  async resume(runId: string): Promise<void> { const run = await this.db.flowRuns.resumeClaim(runId); if (!run) return; return this.transition(runId, run.cursor, run.transitionEpoch); }

  private async executeDelay(run: EngineRun, cursor: number, context: Record<string, unknown>, step: { id: string; props?: { mode?: string; seconds?: number; untilIso?: string } }): Promise<void> {
    const props = step.props ?? {}; let resumeAt: string | null = null;
    if (props.mode === "until" && props.untilIso) { const at = new Date(props.untilIso); resumeAt = Number.isNaN(at.getTime()) ? null : at.toISOString(); }
    else { const seconds = Math.max(1, Math.floor(Number(props.seconds ?? 0))); if (seconds > 0) resumeAt = new Date(Date.now() + seconds * 1000).toISOString(); }
    if (!resumeAt) return this.finish(run.id, "failed", { ...context, [step.id]: { error: { code: "INVALID_DELAY", message: "Delay step has no resolvable resume time" } } });
    await this.scheduleResume(run, resumeAt);
    return this.pause(run, cursor, { ...context, [step.id]: { waiting: true, resumeAt } }, { reason: "delay", resumeAt });
  }

  private async executeApproval(run: EngineRun, cursor: number, context: Record<string, unknown>, step: { id: string; props?: { title?: string; editableFields?: Record<string, unknown>; timeoutHours?: number; onTimeout?: string } }): Promise<void> {
    const props = step.props ?? {}; const timeoutHours = Math.max(1, Math.min(720, Number(props.timeoutHours ?? 72))); const resumeAt = new Date(Date.now() + timeoutHours * 3600000).toISOString();
    await this.db.todos.create(run.orgId, run.id, String(run.createdAt ?? new Date().toISOString()), step.id, props.title || "Approval needed", { ...props.editableFields, timeoutHours, onTimeout: props.onTimeout ?? "reject" });
    return this.pause(run, cursor, { ...context, [step.id]: { waiting: true, title: props.title || "Approval needed" } }, { reason: "approval", resumeAt });
  }

  private async executeSubFlow(run: EngineRun, definition: TFlowDefinition, step: { id: string; props?: { flowId?: string; input?: Record<string, unknown>; waitForCompletion?: boolean } }, cursor: number, context: Record<string, unknown>): Promise<void> {
    const props = resolveProps((step.props ?? {}) as Record<string, unknown>, context) as { flowId?: string; input?: Record<string, unknown>; waitForCompletion?: boolean }; const childFlowId = props.flowId;
    if (!childFlowId) return this.finish(run.id, "failed", { ...context, [step.id]: { error: { code: "SUBFLOW_MISSING_FLOW", message: "sub_flow step has no flowId" } } });
    if (childFlowId === run.flowId) return this.finish(run.id, "failed", { ...context, [step.id]: { error: { code: "SUBFLOW_RECURSION", message: "A flow cannot invoke itself" } } });
    const childVersion = await this.db.flowVersions.currentPublished(childFlowId); if (!childVersion?.definition) return this.finish(run.id, "failed", { ...context, [step.id]: { error: { code: "SUBFLOW_NOT_PUBLISHED", message: `Flow ${childFlowId} has no published version` } } });
    const childDef = childVersion.definition as TFlowDefinition;
    if (props.waitForCompletion === false) {
      const child = await this.db.runs.create({ orgId: run.orgId, projectId: run.projectId, flowId: childFlowId, flowVersionId: childVersion.id, triggerKind: "subflow", context: { trigger: { parentRunId: run.id, parentStepId: step.id, input: props.input ?? {} } } });
      await this.queues.flowStep.add("transition", { runId: child.id, orgId: run.orgId, cursor: 0, epoch: 1 }, { jobId: `step:${child.id}:0:1` });
      return this.advance(run, cursor, { [step.id]: { subflowRunId: child.id, waited: false } }, definition.steps.length);
    }
    const childContext: Record<string, unknown> = { trigger: { parentRunId: run.id, parentStepId: step.id }, ...(props.input ?? {}) }; let childStatus: "succeeded" | "failed" = "succeeded"; let childError: EngineError | null = null;
    for (const childStep of childDef.steps) { try { const outcome = await this.executeStepRecursive(run, childDef, childStep, childContext, 1); if (outcome === "halt") break; } catch (err) { childStatus = "failed"; childError = err instanceof EngineError ? err : EngineError.from(err); break; } }
    const childOutput = { status: childStatus, flowId: childFlowId, steps: childContext };
    if (childStatus === "failed") { const err = childError ?? new EngineError("fatal", "SUBFLOW_FAILED"); return this.applyErrorPolicy(run, definition, step as unknown as Step, cursor, context, new EngineError(err.errorClass, "SUBFLOW_FAILED", `Sub-flow failed: ${err.message}`)); }
    return this.advance(run, cursor, { [step.id]: childOutput }, definition.steps.length);
  }

  private async executeAggregator(run: EngineRun, definition: TFlowDefinition, step: { id: string; props?: { sources?: string[]; mode?: string; separator?: string } }, cursor: number, context: Record<string, unknown>): Promise<void> {
    const props = resolveProps((step.props ?? {}) as Record<string, unknown>, context) as { sources?: string[]; mode?: string; separator?: string };
    return this.advance(run, cursor, { [step.id]: aggregateOutput(props.sources ?? [], props.mode, props.separator, context) }, definition.steps.length);
  }

  private async executeContainer(run: EngineRun, definition: TFlowDefinition, step: Step, cursor: number, context: Record<string, unknown>): Promise<void> {
    const totalSteps = definition.steps.length;
    if (step.type === "branch") { const selected = evaluateFlowCondition(step.condition as any, context) ? step.onTrue : step.onFalse; return this.advance(run, cursor, await this.runInline(run, definition, selected as Step[], context), totalSteps); }
    if (step.type === "router") { const branches = (step as any).branches as Array<{ id: string; condition?: unknown; default?: boolean; steps: Step[] }>; const selected = branches.find((b) => b.condition && evaluateFlowCondition(b.condition as any, context)) ?? branches.find((b) => b.default); const output = selected ? await this.runInline(run, definition, selected.steps, context) : {}; return this.advance(run, cursor, { [step.id]: { branchId: selected?.id ?? null, ...output } }, totalSteps); }
    return this.advance(run, cursor, {}, totalSteps);
  }

  private async executeLoop(run: EngineRun, definition: TFlowDefinition, step: any, cursor: number, context: Record<string, unknown>): Promise<void> {
    const props = resolveProps(step.props ?? {}, context); const items = props.items; if (!Array.isArray(items)) throw new EngineError("validation", "PROP_TYPE_MISMATCH");
    const concurrency = Math.max(1, Math.min(20, Number(props.concurrency ?? 1))); const outputs: unknown[] = new Array(items.length); const basePath = Array.isArray(context.__loopPath) ? context.__loopPath as string[] : [];
    if (concurrency === 1) { for (let i = 0; i < items.length; i++) outputs[i] = await this.runInline(run, definition, step.steps, { ...context, __loopPath: [...basePath, `${step.id}:${i}`], loop: { item: items[i], index: i, total: items.length } }); }
    else { let next = 0; await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { while (next < items.length) { const i = next++; outputs[i] = await this.runInline(run, definition, step.steps, { ...context, __loopPath: [...basePath, `${step.id}:${i}`], loop: { item: items[i], index: i, total: items.length } }); } })); }
    await this.advance(run, cursor, { [step.id]: { items: outputs, count: items.length } }, definition.steps.length);
  }

  private async runInline(run: EngineRun, definition: TFlowDefinition, steps: Step[], context: Record<string, unknown>, depth = 1): Promise<Record<string, unknown>> {
    if (depth > MAX_INLINE_DEPTH) throw new EngineError("fatal", "INLINE_DEPTH_EXCEEDED"); let appended: Record<string, unknown> = {};
    for (const child of steps) { const merged = { ...context, ...appended }; if (child.type === "filter") { if (!evaluateFlowCondition(child.condition as any, merged)) break; appended = { ...appended, [child.id]: { passed: true } }; continue; } if (child.type === "note") { appended = { ...appended, [child.id]: { noted: true } }; continue; } const outcome = await this.executeStepRecursive(run, definition, child, merged, depth); if (outcome === "halt") break; appended = { ...appended, [child.id]: (merged as any)[child.id] ?? {} }; }
    return appended;
  }

  private async executeStepRecursive(run: EngineRun, definition: TFlowDefinition, step: Step, context: Record<string, unknown>, depth: number): Promise<"ok" | "halt"> {
    if (step.type === "filter") { if (!evaluateFlowCondition(step.condition as any, context)) return "halt"; context[step.id] = { passed: true }; return "ok"; }
    if (step.type === "note") { context[step.id] = { noted: true }; return "ok"; }
    if (step.type === "branch") { const selected = evaluateFlowCondition(step.condition as any, context) ? step.onTrue : step.onFalse; await this.runInline(run, definition, selected as Step[], context, depth + 1); return "ok"; }
    if (step.type === "router") { const branches = (step as any).branches as Array<{ id: string; condition?: unknown; default?: boolean; steps: Step[] }>; const selected = branches.find((b) => b.condition && evaluateFlowCondition(b.condition as any, context)) ?? branches.find((b) => b.default); const output = selected ? await this.runInline(run, definition, selected.steps, context, depth + 1) : {}; context[step.id] = { branchId: selected?.id ?? null, ...output }; return "ok"; }
    if (step.type === "loop") { const props = resolveProps((step as any).props ?? {}, context); const items = Array.isArray(props.items) ? props.items : []; const outputs: unknown[] = []; const basePath = Array.isArray(context.__loopPath) ? context.__loopPath as string[] : []; for (let i = 0; i < items.length; i++) outputs.push(await this.runInline(run, definition, (step as any).steps, { ...context, __loopPath: [...basePath, `${step.id}:${i}`], loop: { item: items[i], index: i, total: items.length } }, depth + 1)); context[step.id] = { items: outputs, count: items.length }; return "ok"; }
    if (step.type === "delay" || step.type === "approval") throw new EngineError("fatal", "INLINE_PAUSED", `${step.type} inside a container pauses at the container boundary`);
    if (step.type === "sub_flow") { const props = resolveProps((step.props ?? {}) as Record<string, unknown>, context) as { flowId?: string; input?: Record<string, unknown> }; if (!props.flowId || props.flowId === run.flowId) throw new EngineError("fatal", "SUBFLOW_INVALID"); const childVersion = await this.db.flowVersions.currentPublished(props.flowId); if (!childVersion) throw new EngineError("fatal", "SUBFLOW_NOT_PUBLISHED"); const childContext: Record<string, unknown> = { ...(props.input ?? {}) }; for (const childStep of (childVersion.definition as TFlowDefinition).steps) await this.executeStepRecursive(run, childVersion.definition as TFlowDefinition, childStep, childContext, depth + 1); context[step.id] = { status: "succeeded", flowId: props.flowId, steps: childContext }; return "ok"; }
    if (step.type === "aggregator") { const props = resolveProps((step.props ?? {}) as Record<string, unknown>, context) as { sources?: string[]; mode?: string; separator?: string }; context[step.id] = aggregateOutput(props.sources ?? [], props.mode, props.separator, context); return "ok"; }
    const props = resolveProps((step as Record<string, unknown>).props as Record<string, unknown> ?? {}, context); const result = await this.executeLeaf(run, step, props, context);
    if (result.kind === "ok") { context[step.id] = result.output; return "ok"; }
    if (result.kind === "stop") return "halt";
    const policy = typeof (step as Record<string, unknown>).onError === "string" ? String((step as Record<string, unknown>).onError) : "fail"; const fallbackValue = (step as Record<string, unknown>).fallbackValue;
    if (result.kind === "pause") throw new EngineError("fatal", "INLINE_PAUSED", "pause inside container");
    if (result.kind === "error" && result.error.errorClass !== "auth" && (policy === "continue" || policy === "fallback")) { context[step.id] = policy === "fallback" && fallbackValue !== undefined ? resolveValue(fallbackValue, context) as Record<string, unknown> : { error: { message: result.error.message, code: result.error.code } }; return "ok"; }
    throw result.kind === "error" ? result.error : new EngineError("fatal", "INLINE_ERROR");
  }

  private async executeLeaf(run: EngineRun, step: Step, props: Record<string, unknown>, context: Record<string, unknown>): Promise<Outcome> {
    const handler = this.handlers.get(step.type); if (!handler) return { kind: "error", error: new EngineError("fatal", "NO_HANDLER", `No handler registered for step type ${step.type}`) };
    const retry = retryPolicy(step); let last: Outcome = { kind: "error", error: new EngineError("fatal", "NO_ATTEMPT") }; const loopPath = Array.isArray(context.__loopPath) ? context.__loopPath.join("/") : "root"; const key = `${run.id}:${loopPath}:${step.id}:effect`; const handlerContext = Object.fromEntries(Object.entries(context).filter(([k]) => k !== "__loopPath"));
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) { const started = Date.now(); const completed = await this.db.runSteps.completedByEffectKey(run.id, step.id, key); if (completed) return { kind: "ok", output: completed.outputJson ?? {} }; try { last = await Promise.race([handler.execute({ run, step, props, context: Object.freeze({ ...handlerContext }), attempt, idempotencyKey: key }), new Promise<Outcome>((_, reject) => setTimeout(() => reject(new EngineError("transient", "TIMEOUT")), stepTimeout(step)))]); } catch (error) { last = { kind: "error", error: EngineError.from(error) }; } await this.record(run, step, props, last, Date.now() - started, attempt, key); const retryable = last.kind === "error" && retry.retryOn.includes(last.error.errorClass as any); if (last.kind !== "error" || !retryable || attempt === retry.maxAttempts) return last; await sleep(backoff(attempt, retry)); }
    return last;
  }

  private async advance(run: EngineRun, cursor: number, append: Record<string, unknown>, totalSteps: number): Promise<void> {
    if (cursor + 1 >= totalSteps) return this.finish(run.id, "succeeded", { ...(run.contextJson ?? {}), ...append });
    const state = await this.db.flowRuns.checkpoint(run.id, { expectedCursor: cursor, expectedEpoch: run.transitionEpoch, appendContext: append, nextCursor: cursor + 1, status: "queued" });
    await this.queues.flowStep.add("transition", { runId: run.id, orgId: run.orgId, cursor: state.cursor, epoch: state.transitionEpoch }, { jobId: `step:${run.id}:${state.cursor}:${state.transitionEpoch}` });
  }
  private async scheduleResume(run: EngineRun, resumeAt: string): Promise<void> { const delayMs = Math.max(0, new Date(resumeAt).getTime() - Date.now()); if (!this.queues?.flowStep?.add) return; await this.queues.flowStep.add("resume", { runId: run.id, orgId: run.orgId, kind: "resume" }, { jobId: `resume:${run.id}:${resumeAt}`, delay: delayMs, removeOnComplete: 1000 }); }
  private async pause(run: EngineRun, cursor: number, context: Record<string, unknown>, outcome: { reason: string; resumeAt?: string }, nextCursor = cursor + 1): Promise<void> { await this.db.flowRuns.pause(run.id, { expectedCursor: cursor, expectedEpoch: run.transitionEpoch ?? 1, contextJson: context, reason: outcome.reason, resumeAt: outcome.resumeAt ?? null, nextCursor }); }

  private async applyErrorPolicy(run: EngineRun, definition: TFlowDefinition, step: Step, cursor: number, context: Record<string, unknown>, error: EngineError): Promise<void> {
    const policy = typeof (step as Record<string, unknown>).onError === "string" ? String((step as Record<string, unknown>).onError) : "fail"; const fallbackValue = (step as Record<string, unknown>).fallbackValue; const errorOutput = { error: { message: error.message, code: error.code } };
    if (error.errorClass !== "auth") {
      if (policy === "continue" || policy === "fallback") { const fallback = policy === "fallback" && fallbackValue !== undefined ? resolveValue(fallbackValue, context) : errorOutput; const handled = { ...(context.__handledErrors as Record<string, unknown> ?? {}), [step.id]: errorOutput }; return this.advance(run, cursor, { [step.id]: fallback as Record<string, unknown>, __handledErrors: handled }, definition.steps.length); }
      if (policy !== "fail" && policy !== "stop") { const targetIdx = definition.steps.findIndex((s) => s.id === policy); if (targetIdx > cursor) { const state = await this.db.flowRuns.checkpoint(run.id, { expectedCursor: cursor, expectedEpoch: run.transitionEpoch, appendContext: { [step.id]: errorOutput, __handledErrors: { ...(context.__handledErrors as Record<string, unknown> ?? {}), [step.id]: errorOutput } }, nextCursor: targetIdx, status: "queued" }); await this.queues.flowStep.add("transition", { runId: run.id, orgId: run.orgId, cursor: state.cursor, epoch: state.transitionEpoch }, { jobId: `step:${run.id}:${state.cursor}:${state.transitionEpoch}` }); return; } }
    }
    return this.finish(run.id, "failed", { ...context, [step.id]: errorOutput });
  }

  private async record(run: EngineRun, step: Step, input: unknown, outcome: Outcome, durationMs: number, attempt: number, effectKey: string): Promise<void> { const output = outcome.kind === "ok" ? outcome.output : undefined; await this.db.runSteps.insert({ runId: run.id, runCreatedAt: run.createdAt, orgId: run.orgId, stepId: step.id, stepType: step.type, effectKey, status: outcome.kind === "ok" ? "succeeded" : "failed", inputJson: input as Record<string, unknown>, outputJson: output ?? undefined, errorClass: outcome.kind === "error" ? outcome.error.errorClass : undefined, errorCode: outcome.kind === "error" ? outcome.error.code : undefined, attempt, durationMs }); }

  private async finish(runId: string, status: string, context: unknown): Promise<void> {
    let finalStatus = status; let cleanContext = context;
    if (context && typeof context === "object" && !Array.isArray(context)) {
      const raw = context as Record<string, unknown>; const handled = raw.__handledErrors && typeof raw.__handledErrors === "object" && Object.keys(raw.__handledErrors as object).length > 0;
      if (status === "succeeded" && handled) finalStatus = "handled_error";
      cleanContext = { ...raw }; delete (cleanContext as Record<string, unknown>).__handledErrors; delete (cleanContext as Record<string, unknown>).__replaySteps; delete (cleanContext as Record<string, unknown>).__loopPath;
    }
    await this.db.flowRuns.finish(runId, finalStatus, cleanContext, new Date());
  }
}
