import type { AgentContext, AgentToolResult } from './types';

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface RegisteredTool extends AgentToolDefinition {
  execute(context: AgentContext, input: Record<string, unknown>): Promise<AgentToolResult> | AgentToolResult;
}

/**
 * In-memory tool registry used by the WorkflowAgentLoop.
 * Each tool is registered once and executed through the same boundary.
 * Actual execution logic lives in tool-adapters (Node API side).
 */
export class AgentToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
  }

  definitions(): AgentToolDefinition[] {
    return [...this.tools.values()].map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  async execute(
    context: AgentContext,
    name: string,
    input: Record<string, unknown>,
  ): Promise<AgentToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        callId: `${name}-${Date.now()}`,
        ok: false,
        error: { code: 'UNKNOWN_TOOL', message: `Tool "${name}" is not registered.` },
      };
    }
    try {
      return await tool.execute(context, input);
    } catch (error) {
      return {
        callId: `${name}-${Date.now()}`,
        ok: false,
        error: {
          code: 'TOOL_EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Tool execution failed',
        },
      };
    }
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
