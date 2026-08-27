import type { AgentContext, AgentToolName, AgentToolResult } from './types';
import { AgentToolRegistry } from './tool-registry';

export interface WorkflowToolAdapter {
  getWorkflow?(context: AgentContext, input: Record<string, unknown>): Promise<unknown>;
  validateWorkflow?(context: AgentContext, input: Record<string, unknown>): Promise<unknown>;
  addNode?(context: AgentContext, input: Record<string, unknown>): Promise<unknown>;
  updateNode?(context: AgentContext, input: Record<string, unknown>): Promise<unknown>;
  removeNode?(context: AgentContext, input: Record<string, unknown>): Promise<unknown>;
  connect?(context: AgentContext, input: Record<string, unknown>): Promise<unknown>;
}

export interface IntegrationToolAdapter {
  search?(context: AgentContext, input: Record<string, unknown>): Promise<unknown>;
  schema?(context: AgentContext, input: Record<string, unknown>): Promise<unknown>;
  connections?(context: AgentContext, input: Record<string, unknown>): Promise<unknown>;
}

export interface ExecutionToolAdapter {
  test?(context: AgentContext, input: Record<string, unknown>): Promise<unknown>;
  inspect?(context: AgentContext, input: Record<string, unknown>): Promise<unknown>;
}

const schema = (properties: Record<string, unknown>): Record<string, unknown> => ({ type: 'object', properties, additionalProperties: true });

function adapterTool(name: AgentToolName, description: string, inputSchema: Record<string, unknown>, execute: (context: AgentContext, input: Record<string, unknown>) => Promise<unknown>) {
  return { name, description, inputSchema, async execute(context: AgentContext, input: Record<string, unknown>): Promise<AgentToolResult> {
    try { return { callId: `${name}-${Date.now()}`, ok: true, data: await execute(context, input) }; }
    catch (error) { return { callId: `${name}-${Date.now()}`, ok: false, error: { code: 'DOMAIN_TOOL_FAILED', message: error instanceof Error ? error.message : 'Domain tool failed' } }; }
  }};
}

export function registerDomainTools(
  registry: AgentToolRegistry,
  adapters: { workflow: WorkflowToolAdapter; integrations: IntegrationToolAdapter; execution: ExecutionToolAdapter },
): void {
  const entries = [
    adapterTool('workflow.get', 'Read the current workflow snapshot.', schema({ flowId: { type: 'string' }, versionId: { type: 'string' } }), (c, i) => adapters.workflow.getWorkflow?.(c, i)),
    adapterTool('workflow.validate', 'Validate the current or proposed workflow.', schema({}), (c, i) => adapters.workflow.validateWorkflow?.(c, i)),
    adapterTool('workflow.add_node', 'Add a node to a draft workflow.', schema({ type: { type: 'string' }, config: { type: 'object' } }), (c, i) => adapters.workflow.addNode?.(c, i)),
    adapterTool('workflow.update_node', 'Update a node in a draft workflow.', schema({ nodeId: { type: 'string' }, config: { type: 'object' } }), (c, i) => adapters.workflow.updateNode?.(c, i)),
    adapterTool('workflow.remove_node', 'Remove a node from a draft workflow.', schema({ nodeId: { type: 'string' } }), (c, i) => adapters.workflow.removeNode?.(c, i)),
    adapterTool('workflow.connect', 'Connect two workflow nodes.', schema({ sourceNodeId: { type: 'string' }, targetNodeId: { type: 'string' } }), (c, i) => adapters.workflow.connect?.(c, i)),
    adapterTool('integrations.search', 'Search available integrations, triggers and actions.', schema({ query: { type: 'string' } }), (c, i) => adapters.integrations.search?.(c, i)),
    adapterTool('integrations.schema', 'Read an integration trigger/action schema.', schema({ integration: { type: 'string' }, action: { type: 'string' } }), (c, i) => adapters.integrations.schema?.(c, i)),
    adapterTool('connections.list', 'List safe connection metadata without secrets.', schema({ provider: { type: 'string' } }), (c, i) => adapters.integrations.connections?.(c, i)),
    adapterTool('execution.test', 'Test a workflow or workflow step.', schema({ nodeId: { type: 'string' } }), (c, i) => adapters.execution.test?.(c, i)),
    adapterTool('execution.inspect', 'Inspect a workflow run or failed step.', schema({ runId: { type: 'string' }, stepId: { type: 'string' } }), (c, i) => adapters.execution.inspect?.(c, i)),
  ] as const;
  for (const tool of entries) registry.register(tool);
}
