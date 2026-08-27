import type { AgentToolName, AgentContext, AgentToolResult } from './types';

export interface AgentToolDefinition {
  name: AgentToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (context: AgentContext, input: Record<string, unknown>) => Promise<AgentToolResult>;
}

export class AgentToolRegistry {
  private readonly tools = new Map<AgentToolName, AgentToolDefinition>();

  register(tool: AgentToolDefinition): void {
    if (this.tools.has(tool.name)) throw new Error(`AI tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  get(name: AgentToolName): AgentToolDefinition | undefined {
    return this.tools.get(name);
  }

  definitions(): AgentToolDefinition[] {
    return [...this.tools.values()];
  }

  async execute(context: AgentContext, name: AgentToolName, input: Record<string, unknown>): Promise<AgentToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { callId: `${name}-${Date.now()}`, ok: false, error: { code: 'TOOL_NOT_FOUND', message: `Unknown AI tool: ${name}` } };
    try {
      return await tool.execute(context, input);
    } catch (error) {
      return {
        callId: `${name}-${Date.now()}`,
        ok: false,
        error: { code: 'TOOL_EXECUTION_FAILED', message: error instanceof Error ? error.message : 'Tool execution failed' },
      };
    }
  }
}
