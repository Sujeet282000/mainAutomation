export type AgentIntent = 'answer' | 'build' | 'edit' | 'configure' | 'test' | 'explain' | 'debug';

export type AgentToolName =
  | 'workflow.get'
  | 'workflow.validate'
  | 'workflow.add_node'
  | 'workflow.update_node'
  | 'workflow.remove_node'
  | 'workflow.connect'
  | 'integrations.search'
  | 'integrations.schema'
  | 'connections.list'
  | 'execution.test'
  | 'execution.inspect';

export interface AgentContext {
  workspaceId: string;
  userId: string;
  flowId?: string;
  versionId?: string;
  selectedNodeId?: string;
  conversationId?: string;
  locale?: string;
}

export interface AgentToolCall {
  name: AgentToolName;
  arguments: Record<string, unknown>;
  callId: string;
}

export interface AgentToolResult {
  callId: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface AgentResponse {
  intent: AgentIntent;
  message: string;
  toolCalls: AgentToolCall[];
  toolResults: AgentToolResult[];
  requiresInput?: { field: string; question: string }[];
}
