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
    let pending: AgentToolCall[] = [];
    let requiresInput: AgentResponse['requiresInput'];

    for (let round = 0; round < this.maxRounds; round += 1) {
      const response = await this.model.respond({
        message,
        context: snapshot,
        tools: this.tools.definitions().map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        results,
      });
      finalMessage = response.message;
      intent = response.intent;
      pending = response.toolCalls;
      requiresInput = response.requiresInput;
      if (pending.length === 0) break;

      for (const call of pending) {
        const result = await this.tools.execute(context, call.name, call.arguments);
        result.callId = call.callId;
        results.push(result);
      }
    }

    if (pending.length > 0) {
      finalMessage = finalMessage || 'I could not safely complete all requested workflow operations within the agent limit.';
    }

    return { intent, message: finalMessage, toolCalls: pending, toolResults: results, requiresInput };
  }
}
