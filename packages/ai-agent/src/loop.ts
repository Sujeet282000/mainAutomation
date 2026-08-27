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

/**
 * Provider-neutral multi-round agent loop.
 * Tool execution is deliberately outside the model and is always scoped by
 * the supplied AgentContext. The model gets tool results on subsequent rounds
 * so it can recover from validation errors or continue a multi-step task.
 */
export class WorkflowAgentLoop {
  constructor(
    private readonly model: AgentModel,
    private readonly tools: AgentToolRegistry,
    private readonly contextProvider: AgentContextProvider,
    private readonly maxRounds = 8,
  ) {}

  async run(context: AgentContext, message: string): Promise<AgentResponse> {
    const snapshot = await this.contextProvider.build(context);
    const results: AgentToolResult[] = [];
    let finalMessage = '';
    let intent: AgentResponse['intent'] = 'answer';
    let requiresInput: AgentResponse['requiresInput'];
    let executedCalls = 0;
    let awaitingTools = true;

    for (let round = 0; round < this.maxRounds && awaitingTools; round += 1) {
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
      if (calls.length === 0) {
        awaitingTools = false;
        break;
      }

      for (const call of calls) {
        if (executedCalls >= 32) {
          results.push({ callId: call.callId, ok: false, error: { code: 'TOOL_BUDGET_EXCEEDED', message: 'Maximum tool-call budget exceeded.' } });
          awaitingTools = false;
          break;
        }
        const result = await this.tools.execute(context, call.name, call.arguments);
        result.callId = call.callId;
        results.push(result);
        executedCalls += 1;
      }
    }

    if (awaitingTools) {
      finalMessage = finalMessage || 'I could not safely complete the requested operation within the agent limit.';
    }

    return {
      intent,
      message: finalMessage,
      // These are the calls the model most recently requested; all execution
      // results are authoritative and returned separately.
      toolCalls: [],
      toolResults: results,
      requiresInput,
    };
  }
}
