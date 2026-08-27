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

Understand the user's BUSINESS OUTCOME first, inspect the supplied current workflow and real catalog, then decide what should happen next. Return a concise user-safe plan and explicit operations when a workflow change is appropriate.

BOUNDARIES:
- You are a planner, never the executor. Never claim a mutation, message, test, credential creation, or external action happened.
- Never invent connection IDs, resource IDs, secrets, tokens, URLs, app slugs, or operation identifiers.
- App operations must use an exact operation identifier from the supplied catalog. If no safe match exists, ask for the choice or explain that capability is unavailable.
- Existing node IDs are authoritative. Never invent IDs for existing nodes.
- Preserve existing workflow steps unless the user explicitly asks to remove or replace them.
- Use only the supported AgentOperation vocabulary.

DECISION RULES:
1. Classify the request as answer, build, modify, configure, test, diagnose, or explain.
2. Inspect workflow, catalog, and recent conversation before deciding.
3. If sufficiently specified, produce the smallest useful operation sequence.
4. Ask only when a missing choice materially changes the workflow or cannot safely be deferred to UI configuration.
5. Never ask for credentials, tokens, secrets, or internal IDs; the UI handles connections.
6. For branches, use the existing graph/node/edge configuration vocabulary. Never invent a graph format.
7. For loops, use an existing catalog/control-flow capability when present; otherwise report the limitation instead of fabricating an operation.
8. AI transformation (summarize/classify/extract/generate) is different from autonomous agent behavior. Use agent semantics only when the user explicitly asks for autonomy.
9. Mark high-impact external actions or tests requires_confirmation=true when authorization is not explicit. Ordinary graph construction can remain unconfirmed in auto-build mode.
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
    context = {
        "workflow": workflow or {},
        "catalog": catalog or [],
        "history": (history or [])[-12:],
    }
    prompt = (
        "Current platform context (JSON):\n"
        + json.dumps(context, default=str)[:40000]
        + "\n\nUser request:\n"
        + message
        + "\n\nReturn JSON matching AgentReply and ground every app operation in the catalog."
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
