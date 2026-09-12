// MCP client adapter (P5 #57) — exposes external MCP servers as app "mcp-server":
//   operation "list_tools"  → discover tools on the external server
//   operation "call_tool"   → invoke a tool on the external server
// Connection auth: { url, api_key, headers? }
import { registerAdapter } from "./registry";
import { mcpListTools, mcpCallTool } from "../mcp-client";

registerAdapter("mcp-server", "list_tools", async ({ auth }) => {
  const tools = await mcpListTools(auth);
  return { output: { tools } };
});

registerAdapter("mcp-server", "call_tool", async ({ auth, input, workspaceId, executionId }) => {
  const toolName = String(input.tool ?? "");
  if (!toolName) throw new Error("mcp-server.call_tool requires a `tool` property");
  const args = (input.arguments && typeof input.arguments === "object" ? input.arguments : {}) as Record<string, unknown>;
  const result = await mcpCallTool(auth, toolName, args);
  if (result.isError) {
    throw new Error(`MCP tool ${toolName} reported an error: ${JSON.stringify(result.result).slice(0, 500)}`);
  }
  void workspaceId;
  void executionId;
  return { output: result };
});
