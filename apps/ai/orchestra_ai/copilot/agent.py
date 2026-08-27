"""Conversational Copilot/Agent planning primitives.

The model is a planning layer only. Node remains the security, validation,
mutation and execution authority.
"""
from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, Field

from orchestra_ai.gateway.gateway import CallSpec, Message, ModelGateway, Purpose
from orchestra_ai.schemas.contracts import Attribution

OperationKind = Literal[
    "add_node", "remove_node", "update_node", "connect_nodes",
    "disconnect_nodes", "configure_node", "map_field", "validate_workflow",
    "test_action", "explain_run"
]


class AgentOperation(BaseModel):
    kind: OperationKind
    arguments: dict[str, Any] = Field(default_factory=dict)
    requires_confirmation: bool = False


class PlanStep(BaseModel):
    label: str
    type: str
    app: str
    operation: str = ""
    reasoning: str = ""
    confidence: float = Field(0.0, ge=0.0, le=1.0)


class PlanPreview(BaseModel):
    summary: str
    steps: list[PlanStep] = Field(default_factory=list)
    apps_used: list[dict[str, str]] = Field(default_factory=list)
    missing_connections: list[str] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    reasoning: str = ""


class AgentReply(BaseModel):
    message: str
    intent: Literal[
        "answer", "build_workflow", "modify_workflow", "configure_workflow",
        "test_workflow", "diagnose_workflow", "explain_workflow", "unknown"
    ] = "answer"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    plan: list[str] = Field(default_factory=list, max_length=20)
    operations: list[AgentOperation] = Field(default_factory=list, max_length=64)
    needs_input: list[str] = Field(default_factory=list, max_length=16)
    risks: list[str] = Field(default_factory=list, max_length=16)


SYSTEM = """You are Orchestra Copilot, the intelligent planning layer for a visual automation platform.

Understand the user's business outcome first, inspect the supplied current workflow and real catalog, then decide what should happen next. Return concise user-safe plans and explicit operations when a workflow change is appropriate.

BOUNDARIES:
- You are a planner, never the executor. Never claim a mutation, message, test, credential creation, or external action happened.
- Never invent connection IDs, resource IDs, secrets, tokens, URLs, app slugs, or operation identifiers.
- App operations must use exact operation identifiers from the supplied catalog.
- Existing node IDs are authoritative. Never invent IDs for existing nodes.
- Preserve existing workflow steps unless the user explicitly asks to remove or replace them.
- Use only the supported AgentOperation vocabulary.

DECISION RULES:
1. Classify the request as answer, build, modify, configure, test, diagnose, or explain.
2. Inspect workflow, catalog, and recent conversation before deciding.
3. If sufficiently specified, produce the smallest useful operation sequence.
4. Ask only when a missing choice materially changes the workflow or cannot safely be deferred to UI configuration.
5. Never ask for credentials, tokens, secrets, or internal IDs; the UI handles connections.
6. For branches, use the existing graph/node/edge configuration vocabulary.
7. For loops, use an existing catalog/control-flow capability when present; otherwise report the limitation.
8. AI transformation is different from autonomous agent behavior. Use agent semantics only when the user explicitly asks for autonomy.
9. Mark high-impact external actions or tests requires_confirmation=true when authorization is not explicit.
10. Low confidence should produce a concise clarification, not a guess.
11. Never expose chain-of-thought. plan is only a short observable summary.

SUPPORTED OPERATIONS:
add_node, remove_node, update_node, connect_nodes, disconnect_nodes, configure_node, map_field, validate_workflow, test_action, explain_run.

Return JSON matching AgentReply exactly."""


async def chat(
    gateway: ModelGateway,
    *,
    message: str,
    workflow: dict[str, Any] | None,
    catalog: list[dict[str, Any]] | None,
    history: list[dict[str, str]] | None,
    attribution: Attribution,
) -> AgentReply:
    catalog_summary = _build_catalog_summary(catalog)
    workflow_summary = _build_workflow_summary(workflow)

    context = {
        "available_catalog": catalog_summary,
        "current_workflow": workflow_summary,
        "history": (history or [])[-12:],
    }
    prompt = (
        "Current platform context (JSON):\n"
        + json.dumps(context, default=str)[:40000]
        + "\n\nUser request:\n"
        + message
        + "\n\nReturn JSON matching AgentReply and ground every app operation in the catalog."
        + " Think through intent, catalog grounding, confidence and missing information internally, but return only the structured answer."
    )
    result, _usage = await gateway.call_json(
        CallSpec(
            purpose=Purpose.AGENT_LOOP,
            system=SYSTEM,
            messages=[Message(role="user", content=prompt)],
            attribution=attribution,
        ),
        output_model=AgentReply,
    )
    return result


def _build_catalog_summary(catalog: list[dict[str, Any]] | None) -> dict[str, Any]:
    if not catalog:
        return {"apps": [], "note": "No catalog available — be conservative"}
    apps = []
    for app in catalog:
        ops = app.get("operations", [])
        apps.append({
            "slug": app.get("slug", ""),
            "name": app.get("name", ""),
            "triggers": [o.get("key", "") for o in ops if o.get("type") == "trigger"],
            "actions": [o.get("key", "") for o in ops if o.get("type") != "trigger"],
        })
    return {"apps": apps, "total_apps": len(apps)}


def _build_workflow_summary(workflow: dict[str, Any] | None) -> dict[str, Any]:
    if not workflow:
        return {"exists": False, "nodes": [], "edges": []}
    nodes = workflow.get("nodes", workflow.get("steps", []))
    edges = workflow.get("edges", [])
    return {
        "exists": bool(nodes),
        "node_count": len(nodes),
        "nodes": [
            {
                "id": n.get("id", ""),
                "type": n.get("type", ""),
                "app": n.get("appSlug", ""),
                "operation": n.get("operation", ""),
                "label": n.get("label", ""),
                "has_connection": bool(n.get("connectionId")),
            }
            for n in nodes
        ],
        "edges": edges,
    }
