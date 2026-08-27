from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from orchestra_ai.api.deps import Ctx, require_service_token
from orchestra_ai.gateway.gateway import CallSpec, Message, Purpose, get_gateway

router = APIRouter(prefix="/v1", tags=["runtime"])


class CompleteBody(BaseModel):
    prompt: str
    system: str | None = None
    json_mode: bool = Field(False, alias="json")
    intent: str | None = None
    org_id: str = ""
    request_id: str = ""

    model_config = {"populate_by_name": True}


PURPOSE = {
    "classify": Purpose.AI_STEP_CLASSIFY,
    "extract": Purpose.AI_STEP_EXTRACT,
    "reason": Purpose.AGENT_LOOP,
    "generate": Purpose.AI_STEP_GENERATE,
}


@router.post("/complete")
@router.post("/classify")
@router.post("/extract")
@router.post("/agent-plan")
async def complete(
    body: CompleteBody,
    ctx: Annotated[Ctx, Depends(require_service_token)],
) -> dict[str, Any]:
    gw = get_gateway()
    purpose = PURPOSE.get(body.intent or "generate", Purpose.AI_STEP_GENERATE)
    result = await gw.call(
        CallSpec(
            purpose=purpose,
            system=body.system or "You are the Orchestra AI plane. Be concise and factual.",
            messages=[Message(role="user", content=body.prompt)],
            attribution=ctx.attribution,
        )
    )
    return {"text": result.text, "source": "ai-service", "usage": result.usage.model_dump()}
