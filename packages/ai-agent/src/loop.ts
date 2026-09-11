import type {
  AgentBudgets,
  AgentContext,
  AgentConversationMessage,
  AgentResponse,
  AgentRunEvent,
  AgentRunEventType,
  AgentRunStatus,
  AgentToolCall,
  AgentToolResult,
} from './types';
import { AgentToolRegistry } from './tool-registry';

export interface AgentModel {
  respond(input: { message: string; context: unknown; tools: unknown[]; results: AgentToolResult[] }): Promise<{
    message: string;
    intent: AgentResponse['intent'];
    toolCalls: AgentToolCall[];
    requiresInput?: AgentResponse['requiresInput'];
  }>;
}

export interface AgentContextProvider {
  build(context: AgentContext): Promise<unknown>;
}

/**
 * Tool-calling model contract used by AgentRuntime. `request` receives the
 * full conversation (system, user, assistant/tool turns) and the tool
 * definitions; it returns the next assistant turn. Implementations translate
 * to a specific provider wire format (see apps/api agent model router).
 */
export interface AgentChatModel {
  request(input: {
    messages: AgentConversationMessage[];
    tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
    signal?: AbortSignal;
  }): Promise<{
    message: string;
    toolCalls: AgentToolCall[];
    usage?: { inputTokens: number; outputTokens: number };
    model?: string;
    finishReason?: string;
  }>;
}

export interface AgentRunHooks {
  onEvent?(event: AgentRunEvent): void | Promise<void>;
}

export interface AgentRunOptions {
  runId: string;
  budgets?: Partial<AgentBudgets>;
  signal?: AbortSignal;
  hooks?: AgentRunHooks;
  /** Extra system prompt fragment (agent instructions/knowledge). */
  instructions?: string;
}

export interface AgentRunResult extends AgentResponse {
  runId: string;
  status: AgentRunStatus;
  rounds: number;
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number };
}

const DEFAULT_BUDGETS: AgentBudgets = {
  maxRounds: 12,
  maxToolCalls: 32,
  timeBudgetMs: 120_000,
};

/**
 * Durable, multi-round agent loop with native tool-calling:
 * model decision -> tool execution -> observation -> next model decision.
 * Budgets (rounds / tool calls / wall clock) are enforced across every round;
 * cancellation is checked between every tool execution.
 */
export class AgentRuntime {
  constructor(
    private readonly model: AgentChatModel,
    private readonly tools: AgentToolRegistry,
    private readonly contextProvider?: AgentContextProvider,
    private readonly defaultBudgets: Partial<AgentBudgets> = {},
  ) {}

  async run(context: AgentContext, message: string, opts: AgentRunOptions): Promise<AgentRunResult> {
    const budgets: AgentBudgets = { ...DEFAULT_BUDGETS, ...this.defaultBudgets, ...opts.budgets };
    const deadline = Date.now() + budgets.timeBudgetMs;
    const runId = opts.runId;
    let seq = 0;

    const emit = (type: AgentRunEventType, data: Record<string, unknown> = {}): AgentRunEvent => {
      const event: AgentRunEvent = { runId, seq: seq++, type, at: new Date().toISOString(), data };
      if (opts.hooks?.onEvent) void opts.hooks.onEvent(event);
      return event;
    };

    const snapshot = this.contextProvider ? await this.contextProvider.build(context) : undefined;
    const system = buildSystemPrompt(opts.instructions, snapshot);
    const messages: AgentConversationMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: message },
    ];

    const toolDefs = this.tools.definitions();
    const executedCalls: AgentToolCall[] = [];
    const results: AgentToolResult[] = [];
    const usage = { inputTokens: 0, outputTokens: 0 };
    let finalMessage = '';
    let status: AgentRunStatus = 'running';
    let stopReason = 'completed';
    let rounds = 0;
    let callsUsed = 0;

    emit('run_start', { message, tools: toolDefs.map((t) => t.name) });

    for (let round = 0; round < budgets.maxRounds; round += 1) {
      if (opts.signal?.aborted) {
        status = 'cancelled';
        stopReason = 'cancelled_before_round';
        break;
      }
      if (Date.now() > deadline) {
        status = 'budget_exhausted';
        stopReason = 'time_budget';
        emit('budget_exceeded', { reason: 'time_budget', round });
        break;
      }
      rounds = round + 1;
      emit('round_start', { round });

      let response;
      try {
        response = await this.model.request({
          messages,
          tools: toolDefs,
          signal: opts.signal,
        });
      } catch (error) {
        status = 'failed';
        stopReason = error instanceof Error ? `model_error:${error.message.slice(0, 200)}` : 'model_error';
        break;
      }
      usage.inputTokens += response.usage?.inputTokens ?? 0;
      usage.outputTokens += response.usage?.outputTokens ?? 0;

      finalMessage = response.message;
      const calls = response.toolCalls ?? [];
      emit('model_response', {
        round,
        model: response.model,
        text: finalMessage.slice(0, 4000),
        toolCalls: calls.map((c) => ({ callId: c.callId, name: c.name })),
        usage: response.usage,
      });
      messages.push({ role: 'assistant', content: finalMessage, toolCalls: calls.length ? calls : undefined });

      if (calls.length === 0) {
        status = 'completed';
        stopReason = 'model_stop';
        break;
      }

      let budgetHit = false;
      for (const call of calls) {
        if (opts.signal?.aborted) {
          status = 'cancelled';
          stopReason = 'cancelled_mid_round';
          budgetHit = true;
          break;
        }
        if (Date.now() > deadline || callsUsed >= budgets.maxToolCalls) {
          const reason = Date.now() > deadline ? 'time_budget' : 'tool_call_budget';
          emit('budget_exceeded', { reason, round, callsUsed });
          messages.push({
            role: 'user',
            content: `Budget exceeded (${reason}). Stop calling tools and summarize the outcome for the user now.`,
          });
          status = 'budget_exhausted';
          stopReason = reason;
          budgetHit = true;
          break;
        }

        emit('tool_call_start', { callId: call.callId, name: call.name });
        const result = await executeToolCall(this.tools, context, call, results);
        executedCalls.push(call);
        callsUsed += 1;
        emit('tool_result', {
          callId: call.callId,
          name: call.name,
          ok: result.ok,
          error: result.error,
          dataPreview: preview(result.data),
        });
        // Observation -> conversation so the next round sees the result.
        messages.push({
          role: 'tool',
          content: JSON.stringify(result.ok ? (result.data ?? { ok: true }) : { ok: false, error: result.error }),
          toolCallId: call.callId,
          name: call.name,
        });
      }
      if (budgetHit) break;
    }

    if (status === 'running') {
      status = 'budget_exhausted';
      stopReason = 'round_budget';
      finalMessage =
        finalMessage ||
        'I reached the round limit before finishing. Here is what I found so far — ask me to continue.';
    }
    if (!finalMessage) finalMessage = status === 'completed' ? 'Done.' : '';
    emit('run_complete', { status, stopReason, rounds, usage });

    return {
      runId,
      status,
      intent: 'answer',
      message: finalMessage,
      toolCalls: executedCalls,
      toolResults: results,
      rounds,
      stopReason,
      usage,
      requiresInput: undefined,
    };
  }
}

export class WorkflowAgentLoop {
  constructor(
    private readonly model: AgentModel,
    private readonly tools: AgentToolRegistry,
    private readonly contextProvider: AgentContextProvider,
    private readonly maxRounds = 8,
    private readonly maxToolCalls = 32,
  ) {}

  async run(context: AgentContext, message: string): Promise<AgentResponse> {
    const snapshot = await this.contextProvider.build(context);
    const results: AgentToolResult[] = [];
    const executedCalls: AgentToolCall[] = [];
    let finalMessage = '';
    let intent: AgentResponse['intent'] = 'answer';
    let requiresInput: AgentResponse['requiresInput'];
    let callsUsed = 0;

    for (let round = 0; round < this.maxRounds; round += 1) {
      const response = await this.model.respond({
        message,
        context: snapshot,
        tools: this.tools.definitions().map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        results,
      });
      finalMessage = response.message;
      intent = response.intent;
      requiresInput = response.requiresInput;
      const calls = response.toolCalls ?? [];
      if (calls.length === 0) break;

      for (const call of calls) {
        if (callsUsed >= this.maxToolCalls) {
          results.push({ callId: call.callId, ok: false, error: { code: 'TOOL_BUDGET_EXCEEDED', message: 'Maximum tool-call budget exceeded.' } });
          return { intent, message: finalMessage || 'I could not safely complete the requested operation within the agent limit.', toolCalls: executedCalls, toolResults: results, requiresInput };
        }
        const result = await this.tools.execute(context, call.name, call.arguments);
        result.callId = call.callId;
        executedCalls.push(call);
        results.push(result);
        callsUsed += 1;
      }
    }

    if (!finalMessage) finalMessage = 'I could not safely complete the requested operation within the agent limit.';
    return { intent, message: finalMessage, toolCalls: executedCalls, toolResults: results, requiresInput };
  }
}

async function executeToolCall(
  tools: AgentToolRegistry,
  context: AgentContext,
  call: AgentToolCall,
  results: AgentToolResult[],
): Promise<AgentToolResult> {
  const result = await tools.execute(context, call.name, call.arguments);
  result.callId = call.callId;
  results.push(result);
  return result;
}

function preview(data: unknown): unknown {
  const s = JSON.stringify(data);
  if (s === undefined) return undefined;
  return s.length > 600 ? { preview: `${s.slice(0, 600)}…` } : data;
}

function buildSystemPrompt(instructions: string | undefined, snapshot: unknown): string {
  const base = [
    'You are an automation agent operating inside a workspace.',
    'You can inspect and act through the provided tools. Use tools whenever they help you verify facts or perform actions; never invent tool results.',
    'After each tool result, decide the next step: call another tool, ask the user, or answer.',
    'When you have enough information, reply with a final concise answer and call no more tools.',
    'Never expose secrets, tokens, or connection credentials.',
  ];
  if (instructions) base.push('Agent instructions:', instructions.trim());
  if (snapshot !== undefined) {
    base.push('Current workspace context (JSON):', JSON.stringify(snapshot).slice(0, 6000));
  }
  return base.join('\n\n');
}
