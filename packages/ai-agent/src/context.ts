import type { AgentContext } from './types';

export type AgentRole = 'user' | 'assistant';
export interface AgentConversationTurn { role: AgentRole; content: string; }

export interface WorkflowContextSnapshot {
  flow?: unknown;
  version?: unknown;
  selectedNode?: unknown;
  connections?: Array<{ id: string; provider: string; name?: string }>;
  recentRuns?: unknown[];
  conversation?: AgentConversationTurn[];
}

export interface AgentContextLoader {
  load(context: AgentContext): Promise<WorkflowContextSnapshot>;
}

export class SafeAgentContextBuilder {
  constructor(private readonly loader: AgentContextLoader) {}

  async build(context: AgentContext): Promise<AgentContext & { snapshot: WorkflowContextSnapshot }> {
    if (!context.workspaceId || !context.userId) {
      throw new Error('workspaceId and userId are required for AI context');
    }
    const snapshot = await this.loader.load(context);
    return {
      ...context,
      snapshot: {
        ...snapshot,
        connections: snapshot.connections?.map(({ id, provider, name }) => ({ id, provider, name })),
      },
    };
  }
}
