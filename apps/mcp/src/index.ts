/**
 * Orchestra MCP Server
 *
 * Exposes workflow automation tools via the Model Context Protocol (MCP).
 * External AI assistants (Claude, Cursor, etc.) can discover and invoke
 * these tools to build, inspect, and manage workflows.
 *
 * Transport: HTTP with SSE streaming (compatible with MCP spec).
 * Backend: Node API at API_URL (default http://localhost:4000/api/v1).
 */

import http from "node:http";
import crypto from "node:crypto";

const API_URL = process.env.API_URL ?? "http://localhost:4000/api/v1";
const MCP_PORT = Number(process.env.MCP_PORT ?? 3100);
const SERVICE_TOKEN = process.env.MCP_SERVICE_TOKEN ?? "";

// ── Tool Definitions ────────────────────────────────────────────────────────

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: McpTool[] = [
  {
    name: "workflow_get",
    description: "Get the current workflow definition, nodes, edges, and status for a given flow ID.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string", description: "The workflow/flow ID to inspect" },
      },
      required: ["flowId"],
    },
  },
  {
    name: "workflow_validate",
    description: "Validate a workflow definition and return any issues preventing publication.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string", description: "The workflow/flow ID to validate" },
      },
      required: ["flowId"],
    },
  },
  {
    name: "integrations_list",
    description: "List all available integrations (apps) and their operations (triggers/actions).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional search filter (e.g. 'slack', 'email')" },
      },
    },
  },
  {
    name: "integration_schema",
    description: "Get the full schema for an integration including all operations and their input fields.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Integration slug (e.g. 'gmail', 'slack', 'google-sheets')" },
      },
      required: ["slug"],
    },
  },
  {
    name: "connections_list",
    description: "List connected accounts for the workspace, optionally filtered by integration.",
    inputSchema: {
      type: "object",
      properties: {
        pieceName: { type: "string", description: "Optional filter by integration slug" },
      },
    },
  },
  {
    name: "run_inspect",
    description: "Inspect a workflow run including step statuses and errors.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "The run/execution ID to inspect" },
      },
      required: ["runId"],
    },
  },
  {
    name: "copilot_generate",
    description: "Ask the Copilot to generate or modify a workflow from a natural language description.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Natural language description of the workflow to build" },
        flowId: { type: "string", description: "Optional existing workflow ID to modify" },
      },
      required: ["prompt"],
    },
  },
];

// ── Node API Client ─────────────────────────────────────────────────────────

async function nodeApiGet(path: string, token?: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (SERVICE_TOKEN) headers["x-service-token"] = SERVICE_TOKEN;
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) throw new Error(`Node API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function nodeApiPost(path: string, body: Record<string, unknown>, token?: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (SERVICE_TOKEN) headers["x-service-token"] = SERVICE_TOKEN;
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Node API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Tool Execution ──────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>, orgToken?: string): Promise<unknown> {
  switch (name) {
    case "workflow_get": {
      const data = await nodeApiGet(`/flows/${args.flowId}`, orgToken) as { flow?: { id?: string; name?: string; status?: string }; graph?: unknown };
      return { flowId: data.flow?.id, name: data.flow?.name, status: data.flow?.status, graph: data.graph };
    }
    case "workflow_validate": {
      const data = await nodeApiPost(`/flows/${args.flowId}/validate`, {}, orgToken) as Record<string, unknown>;
      return data;
    }
    case "integrations_list": {
      const q = args.query ? `?q=${encodeURIComponent(String(args.query))}` : "";
      const data = await nodeApiGet(`/catalog${q}`, orgToken) as Record<string, unknown>;
      const apps = (data.apps ?? []) as Array<Record<string, unknown>>;
      return apps.map((a) => ({
        slug: a.slug,
        name: a.name,
        authType: a.authType,
        operationCount: (a.operations as unknown[])?.length ?? 0,
      }));
    }
    case "integration_schema": {
      const data = await nodeApiGet(`/apps/${args.slug}`, orgToken) as Record<string, unknown>;
      return data.app;
    }
    case "connections_list": {
      const data = await nodeApiGet(`/connections`, orgToken) as Record<string, unknown>;
      const conns = (data.connections ?? []) as Array<Record<string, unknown>>;
      if (args.pieceName) {
        return conns.filter((c) => c.piece_name === args.pieceName || c.app_slug === args.pieceName);
      }
      return conns;
    }
    case "run_inspect": {
      const data = await nodeApiGet(`/runs/${args.runId}`, orgToken) as Record<string, unknown>;
      return data;
    }
    case "copilot_generate": {
      const data = await nodeApiPost(`/copilot/generate`, {
        prompt: args.prompt,
        flowId: args.flowId,
        mode: "auto_build",
      }, orgToken) as Record<string, unknown>;
      return data;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP JSON-RPC Server ────────────────────────────────────────────────────

function handleJsonRpc(body: Record<string, unknown>, orgToken?: string): Promise<Record<string, unknown>> {
  const { id, method, params } = body;

  if (method === "initialize") {
    return Promise.resolve({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "orchestra-mcp", version: "0.1.0" },
      },
    });
  }

  if (method === "tools/list") {
    return Promise.resolve({
      jsonrpc: "2.0",
      id,
      result: { tools: TOOLS },
    });
  }

  if (method === "tools/call") {
    const toolName = (params as Record<string, unknown>)?.name as string;
    const toolArgs = ((params as Record<string, unknown>)?.arguments as Record<string, unknown>) ?? {};
    return executeTool(toolName, toolArgs, orgToken)
      .then((result) => ({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        },
      }))
      .catch((err) => ({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        },
      }));
  }

  if (method === "ping") {
    return Promise.resolve({ jsonrpc: "2.0", id, result: {} });
  }

  return Promise.resolve({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Workspace-Id");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // Health check
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "mcp", tools: TOOLS.length }));
    return;
  }

  // MCP endpoint
  if (req.url === "/mcp" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const body = JSON.parse(raw) as Record<string, unknown>;
      const orgToken = req.headers["authorization"]?.replace("Bearer ", "") ?? undefined;
      const result = await handleJsonRpc(body, orgToken);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "parse_error", message: String(err) }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(MCP_PORT, () => {
  console.log(`MCP server listening on http://localhost:${MCP_PORT}/mcp`);
  console.log(`Tools: ${TOOLS.map((t) => t.name).join(", ")}`);
  console.log(`Backend: ${API_URL}`);
});
