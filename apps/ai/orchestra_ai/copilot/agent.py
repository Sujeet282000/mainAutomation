"""Conversational workflow agent primitives.

The agent is intentionally side-effect free: it can reason about the current
workflow and return explicit, validated operations for the Node control plane.
Credentials and durable mutations stay in Node.
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


class AgentReply(BaseModel):
    message: str
    operations: list[AgentOperation] = Field(default_factory=list)
    needs_input: list[str] = Field(default_factory=list)


SYSTEM = """You are Orchestra Copilot, a workflow automation agent.
You can answer normal questions and reason about the user's current workflow.
When a workflow change is requested, return explicit operations rather than
pretending the change was applied. Never invent connection IDs, resource IDs,
secrets, app operations, or successful execution results.
Supported operations: add_node, remove_node, update_node, connect_nodes,
configure_node, validate_workflow, test_action, explain_run.
Use requires_confirmation=true for destructive, publish, or external side
-effect operations. Ask a concise question when required information is
missing. Prefer the supplied workflow/catalog context over assumptions.
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
    context = {
        "workflow": workflow or {},
        "catalog": catalog or [],
        "history": (history or [])[-12:],
    }
    prompt = (
        "Current platform context (JSON):\n"
        + json.dumps(context, default=str)[:30000]
        + "\n\nUser request:\n"
        + message
        + "\n\nReturn JSON matching AgentReply."
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
