export type AgentIntent = 'answer' | 'build' | 'edit' | 'configure' | 'test' | 'explain' | 'debug';

/** Domain tool names for the workflow copilot surface. */
export type AgentDomainToolName =
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

/**
 * Tool names are open strings so platforms can register piece actions
 * (e.g. "slack__send_message") alongside the domain tools above while
 * keeping editor completion for the known domain names.
 */
export type AgentToolName = AgentDomainToolName | (string & {});

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
  /** Provider-specific opaque signature (e.g. Gemini 3 thoughtSignature) that
   *  must be replayed with the tool call on subsequent rounds. */
  thoughtSignature?: string;
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

// ── Durable runtime types ───────────────────────────────────────────────────

export type AgentRunStatus =
  | 'running'
  | 'completed'
  | 'awaiting_approval'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted';

export interface AgentBudgets {
  maxRounds: number;
  maxToolCalls: number;
  timeBudgetMs: number;
}

export type AgentRunEventType =
  | 'run_start'
  | 'round_start'
  | 'model_response'
  | 'tool_call_start'
  | 'tool_result'
  | 'approval_required'
  | 'tool_skipped'
  | 'budget_exceeded'
  | 'run_complete'
  | 'run_error';

export interface AgentRunEvent {
  runId: string;
  seq: number;
  type: AgentRunEventType;
  at: string;
  data: Record<string, unknown>;
}

/**
 * Provider-neutral conversation turn. Model adapters map this onto the
 * provider wire format (OpenAI tool_calls, Anthropic tool_use blocks, etc.).
 */
export interface AgentConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** For role="tool": the assistant tool call this message answers. */
  toolCallId?: string;
  /** For role="tool": the tool name (Gemini functionResponse requires it). */
  name?: string;
  /** For role="assistant": tool calls requested by this turn. */
  toolCalls?: AgentToolCall[];
}
