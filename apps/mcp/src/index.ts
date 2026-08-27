/**
 * Spec: MCP must use the same Tool Registry as agents.
 * This process is the stdio/HTTP transport host; tools are defined in the API tool registry.
 */
export const MCP_TRANSPORTS = ["stdio", "http", "sse"] as const;

if (require.main === module) {
  process.stdout.write(
    JSON.stringify({ service: "mcp", transports: MCP_TRANSPORTS, toolSource: "shared-tool-registry" }) + "\n"
  );
}
