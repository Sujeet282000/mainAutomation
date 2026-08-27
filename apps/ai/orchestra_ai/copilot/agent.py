"""Conversational workflow agent primitives.

The agent is intentionally side-effect free: it can reason about the current
workflow and return explicit, validated operations for the Node control plane.
Credentials and durable mutations stay in Node.

Enhanced capabilities:
  - Intent classification (BUILD_WORKFLOW, MODIFY_WORKFLOW, CONFIGURE, TEST, DIAGNOSE, EXPLAIN)
  - Catalog-grounded operation selection (never invents operations)
  - Confidence scoring per operation
  - Missing information detection (asks before building)
  - Structured plan output with step-by-step reasoning
"""
from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field

from orchestra_ai.gateway.gateway import CallSpec, Message, ModelGateway, Purpose
from orchestra_ai.schemas.contracts import Attribution


class AgentOperation(BaseModel):
    kind: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    requires_confirmation: bool = True


class PlanStep(BaseModel):
    """A single step in the copilot's plan, with reasoning about what it does."""
    label: str
    type: str  # trigger | action | logic
    app: str
    operation: str = ""
    reasoning: str = ""
    confidence: float = Field(0.0, ge=0.0, le=1.0)


class PlanPreview(BaseModel):
    """Structured preview shown to the user before building."""
    summary: str
    steps: list[PlanStep] = Field(default_factory=list)
    apps_used: list[dict[str, str]] = Field(default_factory=list)
    missing_connections: list[str] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    reasoning: str = ""


class AgentReply(BaseModel):
    message: str
    operations: list[AgentOperation] = Field(default_factory=list)
    needs_input: list[str] = Field(default_factory=list)
    intent: str = ""  # BUILD_WORKFLOW | MODIFY_WORKFLOW | CONFIGURE | TEST | DIAGNOSE | EXPLAIN
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    plan: PlanPreview | None = None
    risks: list[str] = Field(default_factory=list)


SYSTEM = """You are Orchestra Copilot, a workflow automation agent.

## Core behavior
You think before you answer. When the user asks you to build or modify a workflow:

1. CLASSIFY the intent first:
   - BUILD_WORKFLOW: Create a new workflow from scratch
   - MODIFY_WORKFLOW: Add, remove, or change steps in an existing workflow
   - CONFIGURE: Set up connections, credentials, or field values
   - TEST: Run or debug the workflow
   - DIAGNOSE: Explain why something failed
   - EXPLAIN: Describe what the workflow does or answer questions

2. CHECK the catalog grounding. Never invent an app or operation that isn't
   in the provided catalog. If the user asks for something unavailable,
   say so clearly and suggest alternatives.

3. SCORE your confidence (0.0 to 1.0):
   - 0.9+: All apps and operations are clearly identified, connections exist
   - 0.7-0.9: Most things are clear, but some choices need user input
   - 0.5-0.7: Significant ambiguity — ask before building
   - Below 0.5: Too uncertain — ask clarifying questions only

4. DETECT missing information. If you need to know:
   - Which Slack channel to send to
   - Which CRM to use
   - Which recipient for WhatsApp
   - Any OAuth connection that doesn't exist yet
   Ask about these before building, or list them as missing_information.

5. RETURN structured operations. When building a workflow, return explicit
   AgentOperations that the Node backend can validate and apply:
   - add_node (with appSlug, operation, nodeId, label, position)
   - connect_nodes (with source, target)
   - configure_node (with nodeId, config)

6. NEVER invent:
   - Connection IDs or credentials
   - Resource IDs (spreadsheet IDs, channel IDs, etc.)
   - API keys or tokens
   - Execution results that haven't happened

7. For MODIFY_WORKFLOW requests against an existing workflow:
   - Read the current workflow structure
   - Identify which nodes to add/remove/update
   - Return minimal operations that achieve the change
   - Preserve existing node configurations when possible

## Response format
Return JSON matching AgentReply with:
  - message: Human-readable explanation of what you're doing
  - intent: One of the classified intents
  - confidence: Your confidence score
  - operations: AgentOperations to apply (empty if just answering)
  - needs_input: Questions you need answered before proceeding
  - plan: A structured PlanPreview showing what you'll build
  - risks: Any concerns about the proposed workflow

When the request is conversational (greetings, questions about the platform),
return a helpful message with no operations and intent=EXPLAIN.
"""


async def chat(
    gateway: ModelGateway,
    *,
    message: str,
    workflow: dict[str, Any] | None,
    catalog: list[dict[str, Any]] | None,
    history: list[dict[str, str]] | None,
    attribution: Attribution,
) -> AgentReply:
    # Build catalog context for grounding
    catalog_summary = _build_catalog_summary(catalog)
    workflow_summary = _build_workflow_summary(workflow)

    context = {
        "available_catalog": catalog_summary,
        "current_workflow": workflow_summary,
        "history": (history or [])[-12:],
    }
    prompt = (
        "Current platform context (JSON):\n"
        + json.dumps(context, default=str)[:30000]
        + "\n\nUser request:\n"
        + message
        + "\n\nThink step by step before responding. Classify the intent, check the catalog, "
        + "score your confidence, detect missing information, then return AgentReply."
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
    """Build a compact catalog summary for the AI to reason against."""
    if not catalog:
        return {"apps": [], "note": "No catalog available — be conservative"}
    apps = []
    for app in catalog:
        ops = app.get("operations", [])
        apps.append({
            "slug": app.get("slug", ""),
            "name": app.get("name", ""),
            "triggers": [o["key"] for o in ops if o.get("type") == "trigger"],
            "actions": [o["key"] for o in ops if o.get("type") != "trigger"],
        })
    return {"apps": apps, "total_apps": len(apps)}


def _build_workflow_summary(workflow: dict[str, Any] | None) -> dict[str, Any]:
    """Build a compact workflow summary."""
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
