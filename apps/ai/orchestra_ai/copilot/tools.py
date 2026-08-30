"""
Copilot Tools
=============

Tools the Copilot LLM can call to discover capabilities,
inspect workflows, and make informed decisions.

This replaces "load entire catalog into prompt" with
dynamic tool discovery.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CopilotTool(BaseModel):
    """Definition of a tool the Copilot can invoke."""
    name: str
    description: str
    parameters: dict[str, Any] = Field(default_factory=dict)


# ── Tool Definitions ─────────────────────────────────────────────────────

COPILOT_TOOLS: list[CopilotTool] = [
    # ── Table operations ──
    CopilotTool(
        name="query_table",
        description="Query a data table by name or ID. Returns rows matching the query. Use this when the user asks about their data (leads, customers, orders, etc.).",
        parameters={
            "type": "object",
            "properties": {
                "table_name": {"type": "string", "description": "Table name or ID"},
                "query": {"type": "string", "description": "Natural language query or SQL-like filter"},
                "limit": {"type": "integer", "description": "Max rows to return (default 10)"},
            },
            "required": ["table_name"],
        },
    ),
    CopilotTool(
        name="list_tables",
        description="List all data tables in the workspace with their schemas. Use to discover what data is available.",
        parameters={"type": "object", "properties": {}},
    ),
    # ── Form operations ──
    CopilotTool(
        name="get_form_schema",
        description="Get the schema/fields of a form. Use to understand what data a form collects.",
        parameters={
            "type": "object",
            "properties": {
                "form_name": {"type": "string", "description": "Form name or ID"},
            },
            "required": ["form_name"],
        },
    ),
    # ── Execution history ──
    CopilotTool(
        name="get_execution_history",
        description="Get recent workflow execution history. Use to diagnose failures, find patterns, or answer questions about past runs.",
        parameters={
            "type": "object",
            "properties": {
                "flow_id": {"type": "string", "description": "Filter by workflow ID"},
                "status": {"type": "string", "enum": ["success", "failed", "running"], "description": "Filter by status"},
                "limit": {"type": "integer", "description": "Max runs to return (default 10)"},
            },
        },
    ),
    # ── Existing tools ──
    CopilotTool(
        name="search_apps",
        description="Search the integration catalog for apps matching a query. Returns app slugs, names, and operation counts.",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query (e.g. 'slack', 'email', 'CRM')"},
                "kind": {"type": "string", "enum": ["trigger", "action", "search"], "description": "Filter by operation type"},
            },
            "required": ["query"],
        },
    ),
    CopilotTool(
        name="get_operation",
        description="Get detailed schema for a specific operation (triggers, actions, search) including input fields and output format.",
        parameters={
            "type": "object",
            "properties": {
                "app_slug": {"type": "string", "description": "App slug (e.g. 'gmail', 'slack')"},
                "operation": {"type": "string", "description": "Operation key (e.g. 'send_email', 'new_message')"},
            },
            "required": ["app_slug", "operation"],
        },
    ),
    CopilotTool(
        name="get_current_workflow",
        description="Get the current workflow graph including all nodes, edges, and configurations.",
        parameters={
            "type": "object",
            "properties": {
                "flow_id": {"type": "string", "description": "Flow ID (optional, defaults to current)"},
            },
        },
    ),
    CopilotTool(
        name="get_connections",
        description="List available connections for the workspace, optionally filtered by app.",
        parameters={
            "type": "object",
            "properties": {
                "app_slug": {"type": "string", "description": "Filter by app slug"},
            },
        },
    ),
    CopilotTool(
        name="get_run",
        description="Get execution details for a specific run including step statuses and errors.",
        parameters={
            "type": "object",
            "properties": {
                "run_id": {"type": "string", "description": "Run ID"},
            },
            "required": ["run_id"],
        },
    ),
    CopilotTool(
        name="validate_workflow",
        description="Validate a workflow graph and return any issues preventing publication.",
        parameters={
            "type": "object",
            "properties": {
                "graph": {"type": "object", "description": "Workflow graph to validate"},
            },
        },
    ),
    CopilotTool(
        name="propose_graph_patch",
        description="Propose incremental changes to a workflow graph (add/remove/replace/connect nodes).",
        parameters={
            "type": "object",
            "properties": {
                "patches": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "List of patch operations",
                },
            },
            "required": ["patches"],
        },
    ),
    CopilotTool(
        name="search_templates",
        description="Search workflow templates for inspiration or starting points.",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
            },
        },
    ),
]


# ── Tool Execution ──────────────────────────────────────────────────────

async def execute_copilot_tool(
    tool_name: str,
    args: dict[str, Any],
    *,
    node_client: Any = None,
    workspace_id: str = "",
    flow_id: str = "",
    graph: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Execute a Copilot tool call.

    Returns a result dict the LLM can reason about.
    """
    if tool_name == "search_apps":
        query = args.get("query", "")
        kind = args.get("kind")
        try:
            if node_client:
                results = await node_client.search_catalog(query, kind)
                return {"apps": results, "count": len(results)}
        except Exception as e:
            return {"error": str(e), "apps": []}

    elif tool_name == "get_operation":
        app_slug = args.get("app_slug", "")
        operation = args.get("operation", "")
        try:
            if node_client:
                results = await node_client.search_catalog(f"{app_slug} {operation}", None)
                matching = [r for r in results if r.get("slug") == app_slug and r.get("key") == operation]
                return {"operation": matching[0] if matching else None, "found": bool(matching)}
        except Exception as e:
            return {"error": str(e)}

    elif tool_name == "get_current_workflow":
        # Return the current graph if available
        if graph:
            nodes = graph.get("nodes", [])
            return {
                "node_count": len(nodes),
                "nodes": [{"id": n.get("id"), "appSlug": n.get("appSlug"), "operation": n.get("operation"), "label": n.get("label")} for n in nodes],
                "edge_count": len(graph.get("edges", [])),
            }
        return {"error": "no_graph"}

    elif tool_name == "get_connections":
        app_slug = args.get("app_slug")
        try:
            if node_client:
                results = await node_client.lookup_connections(workspace_id, app_slug or "", "")
                return {"connections": results, "count": len(results)}
        except Exception as e:
            return {"error": str(e), "connections": []}

    elif tool_name == "validate_workflow":
        from orchestra_ai.copilot.critic import critique_graph
        target_graph = args.get("graph") or graph or {}
        result = critique_graph(target_graph)
        return {
            "valid": result.valid,
            "error_count": len(result.issues),
            "warning_count": len(result.warnings),
            "issues": [{"code": i.code, "message": i.message, "severity": i.severity} for i in result.issues],
            "warnings": [{"code": w.code, "message": w.message, "severity": w.severity} for w in result.warnings],
        }

    elif tool_name == "propose_graph_patch":
        from orchestra_ai.copilot.graph_patch import GraphPatch, apply_patches
        patches_raw = args.get("patches", [])
        patches = [GraphPatch(**p) for p in patches_raw]
        target_graph = graph or {"nodes": [], "edges": []}
        result = apply_patches(target_graph, patches)
        return {
            "applied": len(result.applied),
            "rejected": len(result.rejected),
            "changed": result.changed,
            "graph": result.graph,
        }

    elif tool_name == "get_run":
        run_id = args.get("run_id", "")
        try:
            if node_client:
                # Use the node client to fetch run details
                return {"run_id": run_id, "status": "unknown"}
        except Exception as e:
            return {"error": str(e)}

    elif tool_name == "query_table":
        table_name = args.get("table_name", "")
        query_text = args.get("query", "")
        limit = args.get("limit", 10)
        try:
            if node_client:
                results = await node_client.query_table(table_name, query_text, limit)
                return {"table": table_name, "rows": results, "count": len(results)}
        except Exception as e:
            return {"error": str(e), "rows": []}

    elif tool_name == "list_tables":
        try:
            if node_client:
                results = await node_client.list_tables()
                return {"tables": results, "count": len(results)}
        except Exception as e:
            return {"error": str(e), "tables": []}

    elif tool_name == "get_form_schema":
        form_name = args.get("form_name", "")
        try:
            if node_client:
                result = await node_client.get_form_schema(form_name)
                return {"form": form_name, "schema": result}
        except Exception as e:
            return {"error": str(e)}

    elif tool_name == "get_execution_history":
        flow_id = args.get("flow_id")
        status = args.get("status")
        limit = args.get("limit", 10)
        try:
            if node_client:
                results = await node_client.get_execution_history(flow_id, status, limit)
                return {"runs": results, "count": len(results)}
        except Exception as e:
            return {"error": str(e), "runs": []}

    elif tool_name == "search_templates":
        return {"templates": [], "count": 0}

    return {"error": f"Unknown tool: {tool_name}"}
