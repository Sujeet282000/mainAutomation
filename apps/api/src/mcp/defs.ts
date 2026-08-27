export const MCP_TOOL_DEFS = [
  {
    name: "list_automations",
    description: "List automations in the token workspace",
    scopes: ["automations:read", "tools:invoke"],
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_automation",
    description: "Get one automation and its latest graph",
    scopes: ["automations:read", "tools:invoke"],
    inputSchema: {
      type: "object",
      properties: { automationId: { type: "string" } },
      required: ["automationId"]
    }
  },
  {
    name: "run_automation",
    description: "Queue a manual run of a published automation",
    scopes: ["automations:run", "tools:invoke"],
    inputSchema: {
      type: "object",
      properties: {
        automationId: { type: "string" },
        payload: { type: "object" }
      },
      required: ["automationId"]
    }
  },
  {
    name: "list_executions",
    description: "List recent workflow runs",
    scopes: ["executions:read", "tools:invoke"],
    inputSchema: { type: "object", properties: { limit: { type: "number" } } }
  },
  {
    name: "get_execution",
    description: "Get run status, steps, and logs",
    scopes: ["executions:read", "tools:invoke"],
    inputSchema: {
      type: "object",
      properties: { executionId: { type: "string" } },
      required: ["executionId"]
    }
  },
  {
    name: "list_connections",
    description: "List app connections (no credentials)",
    scopes: ["connections:read", "tools:invoke"],
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "list_tables",
    description: "List workspace data tables",
    scopes: ["tables:read", "tools:invoke"],
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "list_table_records",
    description: "List records in a table",
    scopes: ["tables:read", "tools:invoke"],
    inputSchema: {
      type: "object",
      properties: { tableId: { type: "string" } },
      required: ["tableId"]
    }
  },
  {
    name: "create_table_record",
    description: "Insert a JSON row into a table",
    scopes: ["tables:write", "tools:invoke"],
    inputSchema: {
      type: "object",
      properties: { tableId: { type: "string" }, data: { type: "object" } },
      required: ["tableId", "data"]
    }
  },
  {
    name: "list_forms",
    description: "List workspace forms",
    scopes: ["forms:read", "tools:invoke"],
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_usage",
    description: "Today's usage totals for the organization",
    scopes: ["usage:read", "tools:invoke"],
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "list_apps",
    description: "List catalog apps available in this workspace",
    scopes: ["apps:read", "tools:invoke"],
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "invoke_action",
    description: "Run a catalog action against a connected app (billed as 2 tasks)",
    scopes: ["tools:invoke"],
    inputSchema: {
      type: "object",
      properties: {
        appSlug: { type: "string" },
        operation: { type: "string" },
        connectionId: { type: "string" },
        input: { type: "object" }
      },
      required: ["appSlug", "operation"]
    }
  }
] as const;

export type McpSession = {
  tokenId: string;
  workspaceId: string;
  organizationId: string;
  scopes: string[];
};

export function toolAllowed(session: McpSession, toolName: string) {
  const def = MCP_TOOL_DEFS.find((t) => t.name === toolName);
  if (!def) return false;
  if (session.scopes.includes("*") || session.scopes.includes("tools:invoke")) return true;
  return def.scopes.some((s) => session.scopes.includes(s));
}
