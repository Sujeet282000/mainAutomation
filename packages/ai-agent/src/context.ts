import type { AgentContext } from './types';

export type AgentRole = 'user' | 'assistant';
export interface AgentConversationTurn { role: AgentRole; content: string; }

export interface WorkflowContextSnapshot {
  flow?: unknown;
  version?: unknown;
  selectedNode?: unknown;
  connections?: unknown[];
  recentRuns?: unknown[];
  conversation?: AgentConversationTurn[];
}

export interface AgentContextLoader {
  load(context: AgentContext): Promise<WorkflowContextSnapshot>;
}

export class SafeAgentContextBuilder {
  constructor(private readonly loader: AgentContextLoader) {}

  async build(context: AgentContext): Promise<AgentContext & { snapshot: WorkflowContextSnapshot }> {
    const snapshot = await this.loader.load(context);
    return { ...context, snapshot };
  }
}
