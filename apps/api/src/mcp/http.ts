import { Router } from "express";
import { z } from "zod";
import { hashToken } from "../crypto";
import { query, queryOne } from "../db";
import { writeAudit } from "../modules/audit";
import { invokeMcpTool, MCP_TOOL_DEFS, toolAllowed, type McpSession } from "./tools";

export const mcpHttp = Router();

async function loadSession(req: import("express").Request): Promise<McpSession | null> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) return null;
  const hashed = hashToken(token);
  const row = await queryOne<{
    id: string;
    workspace_id: string;
    organization_id: string | null;
    scopes: string[];
  }>(
    `select t.id, t.workspace_id, t.scopes, coalesce(t.organization_id, w.organization_id) as organization_id
     from mcp_tokens t
     join workspaces w on w.id=t.workspace_id
     where t.token_hash=$1 and t.revoked_at is null`,
    [hashed]
  );
  if (!row?.organization_id) return null;
  await query(`update mcp_tokens set last_used_at=now() where id=$1`, [row.id]);
  return {
    tokenId: row.id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    scopes: row.scopes ?? []
  };
}

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handleRpc(session: McpSession, body: { method?: string; params?: unknown; id?: unknown }) {
  const method = body.method ?? "";
  const id = body.id;
  if (method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "algoverge-automate", version: "0.1.0" }
    });
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return jsonRpcResult(id, {});
  }
  if (method === "ping") {
    return jsonRpcResult(id, {});
  }
  if (method === "tools/list") {
    const tools = MCP_TOOL_DEFS.filter((t) => toolAllowed(session, t.name)).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }));
    return jsonRpcResult(id, { tools });
  }
  if (method === "tools/call") {
    const params = z
      .object({ name: z.string(), arguments: z.record(z.unknown()).optional() })
      .parse(body.params ?? {});
    if (!toolAllowed(session, params.name)) {
      return jsonRpcError(id, -32001, "scope_denied");
    }
    const result = await invokeMcpTool(session, params.name, params.arguments ?? {});
    await writeAudit({
      organizationId: session.organizationId,
      workspaceId: session.workspaceId,
      action: "mcp.tools.call",
      targetType: "mcp_tool",
      targetId: params.name,
      metadata: { tokenId: session.tokenId }
    });
    return jsonRpcResult(id, {
      content: [{ type: "text", text: JSON.stringify(result) }]
    });
  }
  return jsonRpcError(id, -32601, `method_not_found:${method}`);
}

mcpHttp.get(["/", "/sse"], async (req, res) => {
  const session = await loadSession(req);
  if (!session) return res.status(401).json({ error: "mcp_unauthorized" });
  if (req.headers.accept?.includes("text/event-stream")) {
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.write(`event: endpoint\ndata: ${JSON.stringify({ url: "/mcp" })}\n\n`);
    return;
  }
  res.json({
    name: "algoverge-automate",
    protocolVersion: "2024-11-05",
    tools: MCP_TOOL_DEFS.filter((t) => toolAllowed(session, t.name)).map((t) => t.name)
  });
});

mcpHttp.post("/", async (req, res) => {
  const session = await loadSession(req);
  if (!session) return res.status(401).json({ error: "mcp_unauthorized" });
  const payload = req.body;
  try {
    if (Array.isArray(payload)) {
      const out = [];
      for (const item of payload) {
        out.push(await handleRpc(session, item ?? {}));
      }
      return res.json(out);
    }
    res.json(await handleRpc(session, payload ?? {}));
  } catch (err) {
    const message = err instanceof Error ? err.message : "mcp_error";
    res.status(400).json(jsonRpcError(payload?.id, -32000, message));
  }
});

mcpHttp.post("/tools/:name", async (req, res) => {
  const session = await loadSession(req);
  if (!session) return res.status(401).json({ error: "mcp_unauthorized" });
  if (!toolAllowed(session, req.params.name)) return res.status(403).json({ error: "scope_denied" });
  try {
    const result = await invokeMcpTool(session, req.params.name, (req.body ?? {}) as Record<string, unknown>);
    await writeAudit({
      organizationId: session.organizationId,
      workspaceId: session.workspaceId,
      action: "mcp.tools.call",
      targetType: "mcp_tool",
      targetId: req.params.name,
      metadata: { tokenId: session.tokenId, transport: "rest" }
    });
    res.json({ result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "mcp_error" });
  }
});
