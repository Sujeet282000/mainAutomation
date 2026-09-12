// =============================================================================
// MCP client — outbound tool calls to external MCP servers (P5 #57).
//
// The platform already *serves* MCP (apps/mcp + /mcp HTTP transport). This
// module makes MCP bidirectional: workflows and agents can call tools on
// *external* MCP servers (Claude Desktop connectors, third-party MCP hosts)
// through the same adapter pipeline as every other integration.
//
// Connection shape (auth payload on a connection with piece_name "mcp-server"):
//   { url: "https://host/mcp", api_key: "Bearer-token-or-key", headers?: {...} }
// =============================================================================

import { randomUUID } from "node:crypto";
import { writeAudit } from "./modules/audit";

export type McpToolRef = { name: string; description?: string; inputSchema?: unknown };

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: unknown;
  result?: { tools?: McpToolRef[]; content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  error?: { code: number; message: string };
};

function rpcError(code: number, message: string): never {
  throw new Error(`MCP_CLIENT_${code}: ${message}`);
}

/** Minimal JSON-RPC 2.0 over HTTP (the MCP streamable-http transport). */
async function rpc(url: string, headers: Record<string, string>, method: string, params: unknown): Promise<JsonRpcResponse["result"]> {
  const id = randomUUID();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    rpcError(502, `could not reach MCP server: ${err instanceof Error ? err.message : "network error"}`);
  }
  if (!res.ok) rpcError(res.status, `MCP server returned HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as JsonRpcResponse | null;
  if (!body) rpcError(502, "MCP server returned a non-JSON response");
  if (body.error) rpcError(body.error.code, body.error.message);
  return body.result;
}

function authHeaders(auth: Record<string, unknown> | null): { url: string; headers: Record<string, string> } {
  const url = String(auth?.url ?? "");
  if (!/^https?:\/\//.test(url)) throw new Error("MCP connection is missing a valid server url");
  const headers: Record<string, string> = {};
  const key = auth?.api_key ?? auth?.access_token ?? auth?.token;
  if (key) headers.authorization = String(key).startsWith("Bearer ") ? String(key) : `Bearer ${key}`;
  if (auth?.headers && typeof auth.headers === "object") {
    for (const [k, v] of Object.entries(auth.headers as Record<string, unknown>)) {
      if (typeof v === "string") headers[k.toLowerCase()] = v;
    }
  }
  return { url, headers };
}

/** List tools on an external MCP server (P5 #57). */
export async function mcpListTools(auth: Record<string, unknown> | null): Promise<McpToolRef[]> {
  const { url, headers } = authHeaders(auth);
  await rpc(url, headers, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "algoverge-agent", version: "0.1.0" },
  });
  const result = await rpc(url, headers, "tools/list", {});
  return result?.tools ?? [];
}

/** Call a tool on an external MCP server (P5 #57). */
export async function mcpCallTool(
  auth: Record<string, unknown> | null,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { url, headers } = authHeaders(auth);
  const result = await rpc(url, headers, "tools/call", { name: toolName, arguments: args });
  const content = result?.content ?? [];
  const text = content.find((c) => c.type === "text")?.text;
  let parsed: unknown = text;
  if (typeof text === "string") {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  return {
    tool: toolName,
    isError: result?.isError === true,
    result: parsed ?? content,
  };
}

export function parseMcpConnectionAuth(auth: Record<string, unknown> | null): { url: string; headers: Record<string, string> } {
  return authHeaders(auth);
}

export async function auditMcpToolCall(opts: {
  organizationId: string | null | undefined;
  workspaceId: string;
  serverUrl: string;
  toolName: string;
  source: string;
}) {
  await writeAudit({
    organizationId: opts.organizationId ?? null,
    workspaceId: opts.workspaceId,
    action: "mcp_client.tools.call",
    targetType: "mcp_server",
    targetId: opts.serverUrl,
    metadata: { tool: opts.toolName, source: opts.source },
  });
}
