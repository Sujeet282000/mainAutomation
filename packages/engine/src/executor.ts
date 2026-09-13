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
/** Default RetryPolicy per packages/core flow-schema. */
const DEFAULT_RETRY = { maxAttempts: 3, backoff: "exponential" as "fixed" | "exponential", initialDelayMs: 1_000, maxDelayMs: 60_000, retryOn: ["transient" as const] };
function retryPolicy(step: Step): typeof DEFAULT_RETRY {
  const raw = (step as Record<string, unknown>).retry as Partial<typeof DEFAULT_RETRY> | undefined;
  if (!raw) return DEFAULT_RETRY;
  return {
    maxAttempts: Number(raw.maxAttempts ?? DEFAULT_RETRY.maxAttempts),
    backoff: raw.backoff === "fixed" ? "fixed" : "exponential",
    initialDelayMs: Number(raw.initialDelayMs ?? DEFAULT_RETRY.initialDelayMs),
    maxDelayMs: Number(raw.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs),
    retryOn: Array.isArray(raw.retryOn) && raw.retryOn.length ? raw.retryOn : DEFAULT_RETRY.retryOn,
  };
}
/** Delay honoring the schema RetryPolicy: fixed vs exponential, capped at maxDelayMs, plus jitter. */
function backoff(attempt: number, policy: { backoff: "fixed" | "exponential"; initialDelayMs: number; maxDelayMs: number }): number {
  const base = policy.backoff === "fixed"
    ? policy.initialDelayMs
    : Math.min(policy.initialDelayMs * Math.pow(2, attempt - 1), policy.maxDelayMs);
  return Math.min(base, policy.maxDelayMs) + Math.random() * 250;
}
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

/**
 * Fan-in merge shared by top-level and inline aggregator execution.
 * mode "merge"   → spread source outputs (+ `sources` keyed by id, `missing` ids)
 * mode "collect" → `items` array (+ `count`, `text` joined by separator)
 */
export function aggregateOutput(sources: string[], mode: string | undefined, separator: string | undefined, context: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const outputs = sources.map((id) => (context[id] as Record<string, unknown> | undefined) ?? null);
  const present = sources.filter((id) => context[id] !== undefined);
  if (mode === "collect") {
    const items = outputs.filter((o) => o !== null);
    const sep = separator ?? "\n";
    return { items, count: items.length, text: items.map((o) => (typeof o === "string" ? o : JSON.stringify(o))).join(sep), missing: sources.filter((id) => context[id] === undefined) };
  }
  const merged: Record<string, unknown> = {};
  for (const o of outputs) if (o && typeof o === "object") Object.assign(merged, o);
  return { ...merged, sources: Object.fromEntries(present.map((id, i) => [id, outputs[i]])), missing: sources.filter((id) => context[id] === undefined) };
}

/** Recursion depth guard for inline container execution (branch → branch → …). */
const MAX_INLINE_DEPTH = 16;

export class Executor {
  constructor(private readonly db: any, private readonly queues: any, private readonly handlers: Map<string, StepHandler>) {}

  async transition(runId: string, cursor: number, epoch: number): Promise<void> {
    const run = await this.db.flowRuns.claimTransition(runId, cursor, epoch); if (!run) return;
    const version = await this.db.flowVersions.byId(run.flowVersionId); if (!version) throw new EngineError("fatal", "FLOW_VERSION_NOT_FOUND");
    const definition = version.definition as TFlowDefinition; const steps = definition.steps;
    if (cursor >= steps.length) return this.finish(run.id, "succeeded", run.contextJson);
    const step = steps[cursor]; const context = run.contextJson as Record<string, unknown>;
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

  /**
   * Resume a paused run at its stored cursor (delay elapsed or approval
   * resolved). Re-activates the run via an atomic paused→running claim, then
   * re-enters the normal transition loop.
   */
  async resume(runId: string): Promise<void> {
    const run = await this.db.flowRuns.resumeClaim(runId);
    if (!run) return;
    return this.transition(runId, run.cursor, run.transitionEpoch);
  }

  // ── Delay (P0 #4 fix): normalize mode:"duration" into a concrete resumeAt. ──
  // The schema allows { mode: "duration", seconds } or { mode: "until", untilIso }.
  // Resume semantics (durable cursor): the pause checkpoints cursor+1 with the
  // delay marker in the context, so a resumed run CONTINUES after the delay —
  // re-entering at the same cursor would re-execute the delay and re-pause
  // forever. The delayed BullMQ job drives the resume; never a browser timer.
  private async executeDelay(run: { id: string; orgId: string; createdAt?: string }, cursor: number, context: Record<string, unknown>, step: { id: string; props?: { mode?: string; seconds?: number; untilIso?: string } }): Promise<void> {
    const props = step.props ?? {};
    let resumeAt: string | null = null;
    if (props.mode === "until" && props.untilIso) {
      const at = new Date(props.untilIso);
      resumeAt = Number.isNaN(at.getTime()) ? null : at.toISOString();
    } else {
      const seconds = Math.max(1, Math.floor(Number(props.seconds ?? 0)));
      if (seconds > 0) resumeAt = new Date(Date.now() + seconds * 1_000).toISOString();
    }
    if (!resumeAt) {
      // Unparseable delay target — fail the run loudly instead of pausing forever.
      return this.finish(run.id, "failed", { ...context, [step.id]: { error: { code: "INVALID_DELAY", message: "Delay step has no resolvable resume time" } } });
    }
    await this.scheduleResume(run, cursor, resumeAt);
    return this.pause(run, cursor, { ...context, [step.id]: { waiting: true, resumeAt } }, { kind: "pause", reason: "delay", resumeAt });
  }

  // ── Approval (P0 #7): persist the configured timeout so it is enforceable. ──
  // Resume semantics: the pause checkpoints cursor+1 with a waiting marker in
  // the context. The approval decision (user resolve or sweeper timeout
  // policy) resumes the run AFTER this step — never re-creating the todo.
  // The timeout policy itself is owned by the paused-run sweeper
  // (onTimeout approve/reject/fail), so no raw engine resume is scheduled:
  // an unconditional timer resume would bypass the configured policy.
  private async executeApproval(run: { id: string; orgId: string; createdAt?: string }, cursor: number, context: Record<string, unknown>, step: { id: string; props?: { title?: string; editableFields?: Record<string, unknown>; timeoutHours?: number; onTimeout?: string } }): Promise<void> {
    const props = step.props ?? {};
    const timeoutHours = Math.max(1, Math.min(720, Number(props.timeoutHours ?? 72)));
    const resumeAt = new Date(Date.now() + timeoutHours * 3_600_000).toISOString();
    await this.db.todos.create(run.orgId, run.id, String(run.createdAt ?? new Date().toISOString()), step.id, props.title || "Approval needed", { ...props.editableFields, timeoutHours, onTimeout: (step as any).props?.onTimeout ?? "reject" });
    return this.pause(run, cursor, { ...context, [step.id]: { waiting: true, title: props.title || "Approval needed" } }, { kind: "pause", reason: "approval", resumeAt });
  }

  // ── Sub-flow (P0 #3 fix): actually execute the referenced flow version. ────
  // waitForCompletion=false enqueues the child and continues immediately;
  // waitForCompletion=true (default) runs the child inline and merges its step
  // outputs under the child flow id in the parent context.
  private async executeSubFlow(run: { id: string; orgId: string; flowId?: string; projectId?: string; contextJson?: Record<string, unknown> }, definition: TFlowDefinition, step: { id: string; props?: { flowId?: string; input?: Record<string, unknown>; waitForCompletion?: boolean } }, cursor: number, context: Record<string, unknown>): Promise<void> {
    const props = resolveProps((step.props ?? {}) as Record<string, unknown>, context) as { flowId?: string; input?: Record<string, unknown>; waitForCompletion?: boolean };
    const childFlowId = props.flowId;
    if (!childFlowId) {
      return this.finish(run.id, "failed", { ...context, [step.id]: { error: { code: "SUBFLOW_MISSING_FLOW", message: "sub_flow step has no flowId" } } });
    }
    if (childFlowId === run.flowId) {
      return this.finish(run.id, "failed", { ...context, [step.id]: { error: { code: "SUBFLOW_RECURSION", message: "A flow cannot invoke itself" } } });
    }
    const childVersion = await this.db.flowVersions.currentPublished(childFlowId);
    if (!childVersion || !childVersion.definition) {
      return this.finish(run.id, "failed", { ...context, [step.id]: { error: { code: "SUBFLOW_NOT_PUBLISHED", message: `Flow ${childFlowId} has no published version` } } });
    }
    const childDef = childVersion.definition as TFlowDefinition;
    const totalSteps = definition.steps.length;
    if (props.waitForCompletion === false) {
      // Fire-and-forget: enqueue a child run and continue the parent.
      const child = await this.db.runs.create({ orgId: run.orgId, projectId: run.projectId, flowId: childFlowId, flowVersionId: childVersion.id, triggerKind: "subflow", context: { trigger: { parentRunId: run.id, parentStepId: step.id, input: props.input ?? {} } } });
      await this.queues.flowStep.add("transition", { runId: child.id, orgId: run.orgId, cursor: 0, epoch: 1 }, { jobId: `step:${child.id}:0:1` });
      return this.advance(run, cursor, { [step.id]: { subflowRunId: child.id, waited: false } }, totalSteps);
    }
    // Wait mode: execute the child inline against its published definition.
    const childContext: Record<string, unknown> = { trigger: { parentRunId: run.id, parentStepId: step.id }, ...(props.input ?? {}) };
    const childCursor = { i: 0 };
    let childStatus: "succeeded" | "failed" = "succeeded";
    let childError: EngineError | null = null;
    while (childCursor.i < childDef.steps.length) {
      const childStep = childDef.steps[childCursor.i];
      try {
        const outcome = await this.executeStepRecursive(run, childDef, childStep, childContext, 1);
        if (outcome === "halt") { break; }
      } catch (err) {
        childStatus = "failed";
        childError = err instanceof EngineError ? err : EngineError.from(err);
        break;
      }
      childCursor.i += 1;
    }
    const childOutput: Record<string, unknown> = { status: childStatus, flowId: childFlowId, steps: childContext };
    if (childStatus === "failed") {
      const err = childError ?? new EngineError("fatal", "SUBFLOW_FAILED");
      return this.applyErrorPolicy(run, definition, step as unknown as Step, cursor, context, new EngineError(err.errorClass, "SUBFLOW_FAILED", `Sub-flow failed: ${err.message}`));
    }
    return this.advance(run, cursor, { [step.id]: childOutput }, totalSteps);
  }

  /**
   * Aggregator (workflow-parity gap): fan-in merge of previously executed
   * steps' outputs into ONE step output. Shared pure logic so the top-level
   * transition path and inline containers behave identically.
   */
  private async executeAggregator(run: { id: string; orgId: string }, definition: TFlowDefinition, step: { id: string; props?: { sources?: string[]; mode?: string; separator?: string } }, cursor: number, context: Record<string, unknown>): Promise<void> {
    const props = resolveProps((step.props ?? {}) as Record<string, unknown>, context) as { sources?: string[]; mode?: string; separator?: string };
    const output = aggregateOutput(props.sources ?? [], props.mode, props.separator, context);
    return this.advance(run, cursor, { [step.id]: output }, definition.steps.length);
  }

  private async executeContainer(run: { id: string; orgId: string; contextJson?: Record<string, unknown> }, definition: TFlowDefinition, step: Step, cursor: number, context: Record<string, unknown>): Promise<void> {
    const totalSteps = definition.steps.length;
    if (step.type === "branch") { const selected = evaluateFlowCondition(step.condition as any, context) ? step.onTrue : step.onFalse; const inline = await this.runInline(run, definition, selected as Step[], context); return this.advance(run, cursor, inline, totalSteps); }
    if (step.type === "router") { const branches = (step as any).branches; const selected = branches.find((b: any) => b.condition && evaluateFlowCondition(b.condition, context)) ?? branches.find((b: any) => b.default); const output = selected ? await this.runInline(run, definition, selected.steps, context) : {}; return this.advance(run, cursor, { [step.id]: { branchId: selected?.id ?? null, ...output } }, totalSteps); }
    return this.advance(run, cursor, {}, totalSteps);
  }

  // ── Loop (P0 #8): honor props.concurrency (1–20) with bounded parallelism. ──
  private async executeLoop(run: { id: string; orgId: string; transitionEpoch?: number }, definition: TFlowDefinition, step: any, cursor: number, context: Record<string, unknown>): Promise<void> {
    const props = resolveProps(step.props ?? {}, context); const items = props.items; if (!Array.isArray(items)) throw new EngineError("validation", "PROP_TYPE_MISMATCH");
    const concurrency = Math.max(1, Math.min(20, Number(props.concurrency ?? 1)));
    const outputs: unknown[] = new Array(items.length);
    if (concurrency === 1) {
      for (let i = 0; i < items.length; i++) outputs[i] = await this.runInline(run, definition, step.steps, { ...context, loop: { item: items[i], index: i, total: items.length } });
    } else {
      let next = 0;
      const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (next < items.length) {
          const i = next++;
          outputs[i] = await this.runInline(run, definition, step.steps, { ...context, loop: { item: items[i], index: i, total: items.length } });
        }
      });
      await Promise.all(workers);
    }
    await this.advance(run, cursor, { [step.id]: { items: outputs, count: items.length } }, definition.steps.length);
  }

  // ── Inline execution (P0 #6): full recursive semantics for nested steps. ───
  // Previously runInline only handled leaves: nested branch/router/loop/delay/
  // approval/subflow either threw INLINE_ERROR or were skipped. Now every
  // container type executes recursively via executeStepRecursive.
  private async runInline(run: { id: string; orgId: string; transitionEpoch?: number }, definition: TFlowDefinition, steps: Step[], context: Record<string, unknown>, depth = 1): Promise<Record<string, unknown>> {
    if (depth > MAX_INLINE_DEPTH) throw new EngineError("fatal", "INLINE_DEPTH_EXCEEDED");
    let appended: Record<string, unknown> = {};
    for (const child of steps) {
      const merged = { ...context, ...appended };
      if (child.type === "filter") { if (!evaluateFlowCondition(child.condition as any, merged)) break; appended = { ...appended, [child.id]: { passed: true } }; continue; }
      if (child.type === "note") { appended = { ...appended, [child.id]: { noted: true } }; continue; }
      const outcome = await this.executeStepRecursive(run, definition, child, merged, depth);
      if (outcome === "halt") break;
      appended = { ...appended, [child.id]: (merged as any)[child.id] ?? {} };
    }
    return appended;
  }

  /**
   * One recursive primitive for any step inside inline containers (P0 #6).
   * "ok"   → context was updated with the step output, continue.
   * "halt" → a filter broke the branch / a stop outcome ended the branch.
   * Throws on unhandled errors so the container decides (fail vs policy).
   */
  private async executeStepRecursive(run: { id: string; orgId: string; flowId?: string }, definition: TFlowDefinition, step: Step, context: Record<string, unknown>, depth: number): Promise<"ok" | "halt"> {
    if (step.type === "filter") { if (!evaluateFlowCondition(step.condition as any, context)) return "halt"; context[step.id] = { passed: true }; return "ok"; }
    if (step.type === "note") { context[step.id] = { noted: true }; return "ok"; }
    if (step.type === "branch") {
      const selected = evaluateFlowCondition(step.condition as any, context) ? step.onTrue : step.onFalse;
      await this.runInline(run, definition, selected as Step[], context, depth + 1);
      return "ok";
    }
    if (step.type === "router") {
      const branches = (step as any).branches as Array<{ id: string; condition?: unknown; default?: boolean; steps: Step[] }>;
      const selected = branches.find((b) => b.condition && evaluateFlowCondition(b.condition as any, context)) ?? branches.find((b) => b.default);
      const output = selected ? await this.runInline(run, definition, selected.steps, context, depth + 1) : {};
      context[step.id] = { branchId: selected?.id ?? null, ...output };
      return "ok";
    }
    if (step.type === "loop") {
      const props = resolveProps((step as any).props ?? {}, context);
      const items = Array.isArray(props.items) ? props.items : [];
      const outputs: unknown[] = [];
      for (let i = 0; i < items.length; i++) {
        outputs.push(await this.runInline(run, definition, (step as any).steps, { ...context, loop: { item: items[i], index: i, total: items.length } }, depth + 1));
      }
      context[step.id] = { items: outputs, count: items.length };
      return "ok";
    }
    if (step.type === "delay" || step.type === "approval") {
      // Pauses inside inline containers surface as INLINE_PAUSED: the run
      // checkpoints at the container boundary with the pending state recorded.
      throw new EngineError("fatal", "INLINE_PAUSED", `${step.type} inside a container pauses at the container boundary`);
    }
    if (step.type === "sub_flow") {
      // Nested sub-flow: run the child inline and merge its outputs.
      const props = resolveProps((step.props ?? {}) as Record<string, unknown>, context) as { flowId?: string; input?: Record<string, unknown> };
      const childFlowId = props.flowId;
      if (!childFlowId || childFlowId === run.flowId) throw new EngineError("fatal", "SUBFLOW_INVALID");
      const childVersion = await this.db.flowVersions.currentPublished(childFlowId);
      if (!childVersion) throw new EngineError("fatal", "SUBFLOW_NOT_PUBLISHED");
      const childDef = childVersion.definition as TFlowDefinition;
      const childContext: Record<string, unknown> = { ...(props.input ?? {}) };
      for (let i = 0; i < childDef.steps.length; i++) {
        await this.executeStepRecursive(run, childDef, childDef.steps[i], childContext, depth + 1);
      }
      context[step.id] = { status: "succeeded", flowId: childFlowId, steps: childContext };
      return "ok";
    }
    if (step.type === "aggregator") {
      const props = resolveProps((step.props ?? {}) as Record<string, unknown>, context) as { sources?: string[]; mode?: string; separator?: string };
      context[step.id] = aggregateOutput(props.sources ?? [], props.mode, props.separator, context);
      return "ok";
    }
    const props = resolveProps((step as Record<string, unknown>).props as Record<string, unknown> ?? {}, context);
    const result = await this.executeLeaf(run, step, props, context);
    if (result.kind === "ok") { context[step.id] = result.output; return "ok"; }
    if (result.kind === "stop") return "halt";
    // Non-ok inside a container: honor per-step error policy before throwing.
    const onErrorRaw = (step as Record<string, unknown>).onError ?? "fail";
    const policy = typeof onErrorRaw === "string" ? onErrorRaw : "fail";
    const fallbackValue = (step as Record<string, unknown>).fallbackValue;
    if (result.kind === "pause") throw new EngineError("fatal", "INLINE_PAUSED", "pause inside container");
    if (result.kind === "error" && result.error.errorClass !== "auth" && (policy === "continue" || policy === "fallback")) {
      context[step.id] = policy === "fallback" && fallbackValue !== undefined
        ? (resolveValue(fallbackValue, context) as Record<string, unknown>)
        : { error: { message: result.error.message, code: result.error.code } };
      return "ok";
    }
    throw result.kind === "error" ? result.error : new EngineError("fatal", "INLINE_ERROR");
  }

  private async executeLeaf(run: { id: string; orgId: string }, step: Step, props: Record<string, unknown>, context: Record<string, unknown>): Promise<Outcome> {
    const handler = this.handlers.get(step.type); if (!handler) return { kind: "error", error: new EngineError("fatal", "NO_HANDLER") };
    const retry = retryPolicy(step); let last: Outcome = { kind: "error", error: new EngineError("fatal", "NO_ATTEMPT") };
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      const started = Date.now(); const key = `${run.id}:${step.id}:effect`;
      const completed = await this.db.runSteps.completedByEffectKey(run.id, step.id, key); if (completed) return { kind: "ok", output: completed.outputJson ?? {} };
      try { last = await Promise.race([handler.execute({ run, step, props, context: Object.freeze({ ...context }), attempt, idempotencyKey: key }), new Promise<Outcome>((_, reject) => setTimeout(() => reject(new EngineError("transient", "TIMEOUT")), stepTimeout(step)))]); }
      catch (error) { last = { kind: "error", error: EngineError.from(error) }; }
      await this.record(run.id, step, props, last, Date.now() - started, attempt, key);
      const retryable = last.kind === "error" && retry.retryOn.includes(last.error.errorClass as any);
      if (last.kind !== "error" || !retryable || attempt === retry.maxAttempts) return last;
      await sleep(backoff(attempt, retry));
    }
    return last;
  }

  private async advance(run: { id: string; orgId: string; transitionEpoch?: number; contextJson?: Record<string, unknown>; projectId?: string }, cursor: number, append: Record<string, unknown>, totalSteps: number): Promise<void> {
    if (cursor + 1 >= totalSteps) return this.finish(run.id, "succeeded", { ...(run.contextJson ?? {}), ...append });
    const state = await this.db.flowRuns.checkpoint(run.id, { expectedCursor: cursor, expectedEpoch: run.transitionEpoch, appendContext: append, nextCursor: cursor + 1, status: "queued" });
    await this.queues.flowStep.add("transition", { runId: run.id, orgId: run.orgId, cursor: state.cursor, epoch: state.transitionEpoch }, { jobId: `step:${run.id}:${state.cursor}:${state.transitionEpoch}` });
  }

  private async scheduleResume(run: { id: string; orgId: string }, cursor: number, resumeAt: string): Promise<void> {
    const delayMs = Math.max(0, new Date(resumeAt).getTime() - Date.now());
    if (!this.queues?.flowStep?.add) return;
    // BullMQ delayed job: the worker re-enters via executor.resume() at the
    // stored cursor after the delay — never a browser timer.
    await this.queues.flowStep.add("resume", { runId: run.id, orgId: run.orgId, cursor, kind: "resume" }, { jobId: `resume:${run.id}:${cursor}:${resumeAt}`, delay: delayMs, removeOnComplete: 1000 });
  }

  /**
   * Pause a run at `cursor` while ATOMICALLY advancing the stored cursor to
   * `nextCursor` (default: the step after the pause). The durable-cursor
   * contract: resume() re-enters transition() at the STORED cursor, so the
   * pause must move it past the delay/approval step — otherwise a resumed
   * run re-executes the pause step forever (delay re-pauses, approval
   * re-creates its todo).
   */
  private async pause(run: { id: string; transitionEpoch?: number }, cursor: number, context: Record<string, unknown>, outcome: { kind?: string; reason: string; resumeAt?: string }, nextCursor = cursor + 1): Promise<void> { await this.db.flowRuns.pause(run.id, { expectedCursor: cursor, expectedEpoch: run.transitionEpoch ?? 1, contextJson: context, reason: outcome.reason, resumeAt: outcome.resumeAt ?? null, nextCursor }); }

  private async applyErrorPolicy(run: { id: string; orgId: string; transitionEpoch?: number }, definition: TFlowDefinition, step: Step, cursor: number, context: Record<string, unknown>, error: EngineError): Promise<void> {
    // Per-step error policy per the core schema: onError = "fail" | "continue" | StepId.
    // A StepId routes the error to a named handler step; "continue" keeps
    // executing downstream; auth-class failures always stop.
    const onErrorRaw = (step as Record<string, unknown>).onError ?? "fail";
    const policy = typeof onErrorRaw === "string" ? onErrorRaw : "fail";
    const fallbackValue = (step as Record<string, unknown>).fallbackValue;
    const errorOutput = { error: { message: error.message, code: error.code } };
    if (error.errorClass !== "auth") {
      if (policy === "continue" || policy === "fallback") {
        const fallback = policy === "fallback" && fallbackValue !== undefined ? resolveValue(fallbackValue, context) : errorOutput;
        return this.advance(run as any, cursor, { [step.id]: fallback as Record<string, unknown> }, definition.steps.length);
      }
      // onError === <stepId>: route the error to a named error-handler step.
      if (policy !== "fail" && policy !== "stop") {
        const steps = definition.steps;
        const targetIdx = steps.findIndex((s) => s.id === policy);
        if (targetIdx > cursor) {
          const state = await this.db.flowRuns.checkpoint(run.id, { expectedCursor: cursor, expectedEpoch: (run as any).transitionEpoch, appendContext: { [step.id]: errorOutput }, nextCursor: targetIdx, status: "queued" });
          await this.queues.flowStep.add("transition", { runId: run.id, orgId: run.orgId, cursor: state.cursor, epoch: state.transitionEpoch }, { jobId: `step:${run.id}:${state.cursor}:${state.transitionEpoch}` });
          return;
        }
        // Unknown or backwards target: treat as fail (logged via errorOutput).
      }
    }
    return this.finish(run.id, "failed", { ...context, [step.id]: errorOutput });
  }

  private async record(runId: string, step: Step, input: unknown, outcome: Outcome, durationMs: number, attempt: number, effectKey: string): Promise<void> {
    const output = outcome.kind === "ok" ? outcome.output : undefined;
    await this.db.runSteps.insert({ runId, runCreatedAt: "", orgId: "", stepId: step.id, stepType: step.type, effectKey, status: outcome.kind === "ok" ? "succeeded" : "failed", inputJson: input as Record<string, unknown>, outputJson: output ?? undefined, errorClass: outcome.kind === "error" ? outcome.error.errorClass : undefined, errorCode: outcome.kind === "error" ? outcome.error.code : undefined, attempt, durationMs });
  }

  private async finish(runId: string, status: string, context: unknown): Promise<void> {
    await this.db.flowRuns.finish(runId, status, context, new Date());
  }
}
