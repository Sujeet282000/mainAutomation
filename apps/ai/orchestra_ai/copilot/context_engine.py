"""
Context Engine
==============

Assembles a rich context package for every Copilot request.

Instead of the model blindly seeing "add Slack", it sees:
  - User is editing workflow X
  - Currently selected node is AI qualification
  - Slack connection exists
  - Previous step outputs lead.email
  - Current branch is hot-lead
  - Last run failed because channel was missing

This is what makes the Copilot feel intelligent.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field


class WorkspaceContext(BaseModel):
    """Workspace-level context."""
    id: str = ""
    name: str = ""
    timezone: str = "UTC"
    preferences: dict[str, Any] = Field(default_factory=dict)
    ai_enabled: bool = True
    agents_enabled: bool = True


class WorkflowContext(BaseModel):
    """Current workflow being edited."""
    id: str = ""
    name: str = ""
    status: str = "draft"
    graph: dict[str, Any] = Field(default_factory=dict)
    node_count: int = 0
    nodes_summary: list[dict[str, Any]] = Field(default_factory=list)
    selected_node_id: str | None = None
    selected_node: dict[str, Any] | None = None


class ConnectionContext(BaseModel):
    """Available connections for the workspace."""
    total: int = 0
    connected: list[dict[str, Any]] = Field(default_factory=list)
    apps_with_connections: list[str] = Field(default_factory=list)


class RunContext(BaseModel):
    """Recent run context."""
    recent_runs: list[dict[str, Any]] = Field(default_factory=list)
    last_error: dict[str, Any] | None = None
    failed_step: dict[str, Any] | None = None


class CatalogContext(BaseModel):
    """Available catalog capabilities."""
    total_apps: int = 0
    total_operations: int = 0
    live_adapters: list[str] = Field(default_factory=list)
    top_apps: list[dict[str, Any]] = Field(default_factory=list)


class TableContext(BaseModel):
    """Workspace data tables (CRM, databases, etc.)."""
    tables: list[dict[str, Any]] = Field(default_factory=list)
    total_tables: int = 0


class FormContext(BaseModel):
    """Workspace forms for human input."""
    forms: list[dict[str, Any]] = Field(default_factory=list)
    total_forms: int = 0


class AgentContext(BaseModel):
    """Registered agents in the workspace."""
    agents: list[dict[str, Any]] = Field(default_factory=list)
    total_agents: int = 0


class ExecutionContext(BaseModel):
    """Recent execution history for pattern detection."""
    history: list[dict[str, Any]] = Field(default_factory=list)
    total_runs: int = 0
    recent_failures: list[dict[str, Any]] = Field(default_factory=list)


class ConversationContext(BaseModel):
    """Conversation history."""
    messages: list[dict[str, str]] = Field(default_factory=list)
    session_id: str = ""


class CopilotContext(BaseModel):
    """Complete context package for a Copilot request."""
    workspace: WorkspaceContext = Field(default_factory=WorkspaceContext)
    workflow: WorkflowContext = Field(default_factory=WorkflowContext)
    connections: ConnectionContext = Field(default_factory=ConnectionContext)
    runs: RunContext = Field(default_factory=RunContext)
    tables: TableContext = Field(default_factory=TableContext)
    forms: FormContext = Field(default_factory=FormContext)
    agents_ctx: AgentContext = Field(default_factory=AgentContext)
    execution: ExecutionContext = Field(default_factory=ExecutionContext)
    catalog: CatalogContext = Field(default_factory=CatalogContext)
    conversation: ConversationContext = Field(default_factory=ConversationContext)
    current_page: str = ""
    user_request: str = ""

    def to_prompt_context(self) -> str:
        """Serialize context into a prompt-friendly string."""
        parts = []

        # Workspace
        if self.workspace.name:
            parts.append(f"Workspace: {self.workspace.name} (tz={self.workspace.timezone})")

        # Workflow
        if self.workflow.id:
            parts.append(f"\nCurrent workflow: {self.workflow.name} ({self.workflow.status})")
            parts.append(f"Steps: {self.workflow.node_count}")
            for node in self.workflow.nodes_summary:
                parts.append(f"  - [{node.get('id')}] {node.get('appSlug', '?')}/{node.get('operation', '?')} ({node.get('label', '')})")
            if self.workflow.selected_node:
                sel = self.workflow.selected_node
                parts.append(f"  Currently selected: [{sel.get('id')}] {sel.get('appSlug', '?')}/{sel.get('operation', '?')}")

        # Connections
        if self.connections.apps_with_connections:
            parts.append(f"\nConnected apps: {', '.join(self.connections.apps_with_connections)}")

        # Tables
        if self.tables.tables:
            parts.append(f"\nData tables ({self.tables.total_tables}):")
            for t in self.tables.tables[:10]:
                cols = t.get("columns", [])
                col_names = [c.get("name", "?") for c in cols[:5]] if isinstance(cols, list) else []
                parts.append(f"  - {t.get('name', '?')} ({', '.join(col_names)}{'...' if len(cols) > 5 else ''})")

        # Forms
        if self.forms.forms:
            parts.append(f"\nForms ({self.forms.total_forms}):")
            for f in self.forms.forms[:5]:
                parts.append(f"  - {f.get('name', '?')}")

        # Agents
        if self.agents_ctx.agents:
            parts.append(f"\nAgents ({self.agents_ctx.total_agents}):")
            for a in self.agents_ctx.agents[:5]:
                parts.append(f"  - {a.get('name', '?')} ({a.get('status', 'unknown')})")

        # Execution history
        if self.execution.recent_failures:
            parts.append("\nRecent failures:")
            for f in self.execution.recent_failures[:3]:
                parts.append(f"  - {f.get('flow_name', '?')}: {f.get('error', '?')[:120]}")

        # Recent runs
        if self.runs.last_error:
            err = self.runs.last_error
            parts.append(f"\nLast error: step={err.get('step_id', '?')} error={err.get('error', '?')}")
        if self.runs.failed_step:
            fs = self.runs.failed_step
            parts.append(f"Failed step: [{fs.get('step_id', '?')}] {fs.get('error', '?')}")

        # Conversation
        if self.conversation.messages:
            parts.append("\nRecent conversation:")
            for msg in self.conversation.messages[-6:]:  # last 6 messages
                parts.append(f"  {msg.get('role', 'user')}: {msg.get('content', '')[:200]}")

        return "\n".join(parts)


# ── Context Builder ───────────────────────────────────────────────────────────

class ContextBuilder:
    """
    Builds a CopilotContext from raw data.

    This is called before every Copilot request to assemble
    the full context the model needs.
    """

    def build(
        self,
        *,
        user_request: str = "",
        workspace_data: dict[str, Any] | None = None,
        workflow_data: dict[str, Any] | None = None,
        selected_node_id: str | None = None,
        connections_data: list[dict[str, Any]] | None = None,
        recent_runs: list[dict[str, Any]] | None = None,
        catalog_data: dict[str, Any] | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        session_id: str = "",
        current_page: str = "",
    ) -> CopilotContext:
        """Build a full context package from raw data."""

        ctx = CopilotContext(
            user_request=user_request,
            current_page=current_page,
        )

        # Workspace
        if workspace_data:
            ctx.workspace = WorkspaceContext(
                id=str(workspace_data.get("id", "")),
                name=str(workspace_data.get("name", "")),
                timezone=str(workspace_data.get("timezone", "UTC")),
                preferences=workspace_data.get("preferences", {}),
                ai_enabled=workspace_data.get("ai_enabled", True),
                agents_enabled=workspace_data.get("agents_enabled", True),
            )

        # Workflow
        if workflow_data:
            graph = workflow_data.get("graph", workflow_data.get("draft_definition", {}))
            nodes = graph.get("nodes", [])
            edges = graph.get("edges", [])

            ctx.workflow = WorkflowContext(
                id=str(workflow_data.get("id", "")),
                name=str(workflow_data.get("name", "")),
                status=str(workflow_data.get("status", "draft")),
                graph=graph,
                node_count=len(nodes),
                nodes_summary=[
                    {
                        "id": n.get("id"),
                        "appSlug": n.get("appSlug", ""),
                        "operation": n.get("operation", ""),
                        "label": n.get("label", ""),
                        "type": n.get("type", ""),
                    }
                    for n in nodes
                ],
                selected_node_id=selected_node_id,
                selected_node=next((n for n in nodes if n["id"] == selected_node_id), None) if selected_node_id else None,
            )

        # Connections
        if connections_data:
            connected_apps = list({c.get("app_slug") or c.get("appSlug", "") for c in connections_data if c.get("status") == "active" or c.get("status") == "connected"})
            ctx.connections = ConnectionContext(
                total=len(connections_data),
                connected=[
                    {
                        "id": c.get("id"),
                        "name": c.get("name") or c.get("label"),
                        "app_slug": c.get("app_slug") or c.get("appSlug"),
                        "status": c.get("status"),
                    }
                    for c in connections_data
                ],
                apps_with_connections=[a for a in connected_apps if a],
            )

        # Runs
        if recent_runs:
            ctx.runs = RunContext(
                recent_runs=[
                    {
                        "id": r.get("id"),
                        "status": r.get("status"),
                        "flow_name": r.get("flow_name"),
                        "created_at": r.get("created_at"),
                    }
                    for r in recent_runs[:5]
                ],
            )
            # Find last failed step
            for run in recent_runs:
                if run.get("status") == "failed":
                    ctx.runs.last_error = {
                        "run_id": run.get("id"),
                        "error": run.get("error"),
                    }
                    break

        # Catalog
        if catalog_data:
            apps = catalog_data.get("apps", [])
            live = []
            for app in apps:
                for adapter_key in catalog_data.get("adapters", []):
                    if adapter_key.startswith(app.get("slug", "") + ":"):
                        live.append(app.get("slug", ""))
                        break
            ctx.catalog = CatalogContext(
                total_apps=len(apps),
                total_operations=sum(len(a.get("operations", [])) for a in apps),
                live_adapters=list(set(live)),
                top_apps=[
                    {"slug": a.get("slug"), "name": a.get("name"), "ops": len(a.get("operations", []))}
                    for a in apps[:20]
                ],
            )

        # Tables
        tables_data = workspace_data.get("tables", []) if workspace_data else []
        if tables_data:
            ctx.tables = TableContext(
                tables=[{"id": t.get("id"), "name": t.get("name"), "slug": t.get("slug"), "columns": t.get("columns", [])} for t in tables_data],
                total_tables=len(tables_data),
            )

        # Forms
        forms_data = workspace_data.get("forms", []) if workspace_data else []
        if forms_data:
            ctx.forms = FormContext(
                forms=[{"id": f.get("id"), "name": f.get("name"), "schema": f.get("schema")} for f in forms_data],
                total_forms=len(forms_data),
            )

        # Agents
        agents_data = workspace_data.get("agents", []) if workspace_data else []
        if agents_data:
            ctx.agents_ctx = AgentContext(
                agents=[{"id": a.get("id"), "name": a.get("name"), "status": a.get("status")} for a in agents_data],
                total_agents=len(agents_data),
            )

        # Execution history
        exec_data = workspace_data.get("executionHistory", []) if workspace_data else []
        if exec_data:
            ctx.execution = ExecutionContext(
                history=exec_data,
                total_runs=len(exec_data),
                recent_failures=[r for r in exec_data if r.get("status") == "failed"][:5],
            )

        # Conversation
        if conversation_history:
            ctx.conversation = ConversationContext(
                messages=conversation_history,
                session_id=session_id,
            )

        return ctx
