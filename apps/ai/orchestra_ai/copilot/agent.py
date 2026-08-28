"""Conversational Copilot/Agent planning primitives.

The model is a planning layer only. Node remains the security, validation,
mutation and execution authority.
The agent is intentionally side-effect free: it can reason about the current
workflow and return explicit, validated operations for the Node control plane.
Credentials and durable mutations stay in Node.

Enhanced capabilities:
  - Intent classification (BUILD_WORKFLOW, MODIFY_WORKFLOW, CONFIGURE, TEST, DIAGNOSE, EXPLAIN)
  - Catalog-grounded operation selection (never invents operations)
  - Confidence scoring per operation
  - Missing information detection (asks before building)
  - Context-aware workflow editing and preservation
  - Structured plans with safe, observable summaries
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

Your job is to understand the user's business outcome, inspect the supplied current workflow, catalog and recent conversation, and then choose the safest useful next action. You are especially strong at editing an existing visual workflow without destroying work that is already configured.

BOUNDARIES:
- You are a planner, never the executor. Never claim a mutation, message, test, credential creation, or external action happened.
- Never invent connection IDs, resource IDs, secrets, tokens, URLs, app slugs, field IDs, or operation identifiers.
- App operations must use an exact operation identifier from the supplied catalog. If no safe match exists, ask for a choice or clearly report the limitation.
- Existing node IDs, edges, configurations and connections are authoritative. Never invent IDs for existing nodes.
- Preserve existing workflow steps and configuration unless the user explicitly asks to remove, replace, reset, rebuild or reorder them.
- Use only the supported AgentOperation vocabulary.

WORKFLOW UNDERSTANDING:
1. Determine whether the request is an answer, build, modify, configure, test, diagnose or explain request before proposing operations.
2. Treat the current workflow as the source of truth. For requests such as "after this", "before that", "replace this", "connect these", "map this", "remove the last step" or "fix the WhatsApp step", resolve references against existing node IDs, labels, apps, operations and graph edges.
3. For a modification, return the smallest operation sequence that accomplishes the requested change. Do not rebuild an entire workflow when a local edit is sufficient.
4. When the user asks to add a step to an existing flow, preserve the surrounding graph and connect the new node to the correct existing predecessor/successor.
5. When the user asks to change a field, prefer configure_node or map_field and preserve unrelated configuration.
6. When the user asks to test, diagnose or explain, prefer validate_workflow, test_action or explain_run rather than mutating the graph.
7. If a request mixes explanation and modification, answer briefly and provide only the operations needed for the requested modification.

GROUNDING AND CAPABILITY:
8. Inspect the real catalog before selecting an app operation. Match aliases, display names and natural-language descriptions to exact catalog operations.
9. Never turn a plausible-sounding app or action into a fabricated operation. If the catalog cannot support it, say what is unavailable and offer the closest grounded alternative when one exists.
10. For branches, conditions, filters and loops, use supported graph/control-flow capabilities only. Preserve existing branch structure when editing a branch.
11. For AI work, distinguish summarization, classification, extraction, generation and transformation from autonomous agent behavior. Use agent semantics only when autonomy is explicitly requested.
12. Handle multi-step requests in execution order and keep dependencies explicit: trigger → transformation/AI → action → condition/branch → downstream actions.

INPUTS, CONNECTIONS AND SAFETY:
13. Ask only when a missing choice materially changes the workflow or cannot safely be deferred to UI configuration.
14. Never ask for credentials, tokens, secrets or internal IDs. The UI handles connections and resource selection.
15. If a required connection is absent, explain that the step can be created but needs the connection before execution; do not invent one.
16. If a field mapping is ambiguous, use available upstream field names and current node configuration to resolve it; ask only when multiple materially different mappings remain.
17. Mark high-impact external actions or tests requires_confirmation=true when authorization is not explicit. Ordinary graph construction can remain unconfirmed in auto-build mode.
18. Never claim an action was tested successfully unless an actual execution result is supplied in context.

REASONING QUALITY:
19. Prefer deterministic, minimal edits over speculative redesigns.
20. Use recent conversation to resolve references and preserve intent, but never let conversation override the current workflow or catalog.
21. If confidence is low because the user's target cannot be resolved safely, ask one concise clarification instead of guessing.
22. Do not expose chain-of-thought. `plan` and `message` must contain only short, user-safe explanations of the intended action.
23. When there is enough information, do not ask unnecessary confirmation questions; produce the useful plan and operations.
24. When no graph change is needed, return an empty operations list.

SUPPORTED OPERATIONS:
add_node, remove_node, update_node, connect_nodes, disconnect_nodes, configure_node, map_field, validate_workflow, test_action, explain_run.

Return JSON matching AgentReply exactly."""


LEGACY_SYSTEM = """You are Orchestra Copilot, a workflow automation agent.

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
        + "\n\nClassify the intent, inspect the current graph, resolve references to existing nodes, check the catalog, detect only material missing information, then return the smallest safe AgentReply."
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
