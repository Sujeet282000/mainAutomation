"""Conversational Copilot endpoint.

This endpoint handles both ordinary questions and workflow-agent requests.
It returns explicit operations for the Node control plane to validate/apply;
it never claims a mutation happened when it did not.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from orchestra_ai.api.deps import Ctx, require_service_token
from orchestra_ai.copilot.agent import AgentReply, chat
from orchestra_ai.gateway.gateway import get_gateway

router = APIRouter(prefix="/copilot", tags=["copilot-agent"])


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=12000)
    workflow: dict[str, Any] | None = None
    catalog: list[dict[str, Any]] = Field(default_factory=list)
    history: list[dict[str, str]] = Field(default_factory=list)
    session_id: str = ""
    flow_id: str = ""
    org_id: str = ""
    request_id: str = ""


@router.post("/chat", response_model=AgentReply)
async def copilot_chat(
    body: ChatRequest,
    ctx: Annotated[Ctx, Depends(require_service_token)],
) -> AgentReply:
    """Answer a user question using workflow context and propose safe operations."""
    return await chat(
        get_gateway(),
        message=body.message,
        workflow=body.workflow,
        catalog=body.catalog,
        history=body.history,
        attribution=ctx.attribution,
    )
