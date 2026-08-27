# MCP

Algoverge exposes an **MCP-compatible HTTP server** so Cursor, Claude Desktop, and other MCP clients can call approved workspace tools. Credentials never leave hashed storage; each call is written to `audit_logs`.

## Platform MCP (this repo)

1. Sign in at http://localhost:3000 → **Settings**.
2. Create an MCP token (shown once). Scopes default to `tools:invoke` (all listed tools). Narrow with `automations:read`, `automations:run`, `executions:read`, `connections:read`, `tables:read`, `tables:write`, `forms:read`, `usage:read`, `apps:read`.
3. Endpoint: `http://localhost:4000/mcp` (also `http://localhost:4000/api/v1/mcp`).
4. Header: `Authorization: Bearer avmcp_…`

JSON-RPC methods: `initialize`, `tools/list`, `tools/call`, `ping`. REST helper: `POST /mcp/tools/:name` with the same bearer token.

Approved tools: list/get/run automations, list/get executions, list connections (no secrets), list tables/records, create table records (write scope), list forms, usage, apps.

Cursor project config (no secrets in git). Put the token in your user env or Cursor MCP UI, not in a committed file:

```json
{
  "mcpServers": {
    "algoverge-automate": {
      "url": "http://localhost:4000/mcp"
    }
  }
}
```

Then set the Authorization header in Cursor Settings → MCP for that server. Do not commit `avmcp_` tokens.

## Official Supabase MCP (hosted database)

Use this when you want the AI client to inspect **your** Supabase project (schema, migrations, logs). This is separate from Algoverge workspace MCP.

1. Create a Supabase project (see [MANUAL_SETUP.md](../MANUAL_SETUP.md)).
2. Create a Supabase personal access token: [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).
3. Copy the project ref from the project URL (`https://<project-ref>.supabase.co`).

Cursor user MCP (Settings → MCP), **not** committed secrets:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--read-only",
        "--project-ref",
        "YOUR_SUPABASE_PROJECT_REF"
      ],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "YOUR_SUPABASE_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

Hosted option: [mcp.supabase.com](https://supabase.com/docs/guides/getting-started/mcp) with OAuth. Prefer `--read-only` until you need apply-migration tools.

`.cursor/mcp.json` in this repo only points at the local Algoverge MCP URL. Supabase tokens stay in your Cursor user settings.
