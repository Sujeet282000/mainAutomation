import type { AgentContext, AgentResponse, AgentToolCall, AgentToolResult } from './types';
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

/** Provider-neutral multi-round agent loop. */
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
