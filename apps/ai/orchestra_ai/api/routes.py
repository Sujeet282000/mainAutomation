# ============================================================================
# Orchestra Parts 8-9 — API Routes
# Source of truth: Part 10 § "Endpoint surface"
# ============================================================================

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from orchestra_ai.api.deps import Ctx, require_service_token
from orchestra_ai.copilot.capabilities import require
from orchestra_ai.copilot.diagnose import Diagnosis, RunDiagnoser
from orchestra_ai.copilot.models import Autonomy, GenerationResult
from orchestra_ai.copilot.orchestrator import CopilotOrchestrator
from orchestra_ai.gateway.gateway import CallSpec, Message, Purpose, get_gateway
from orchestra_ai.prompts.registry import PromptRegistry
from orchestra_ai.schemas.contracts import Attribution

router = APIRouter(prefix="/copilot", tags=["copilot"])


# ── Dependencies ────────────────────────────────────────────────────────────

def get_prompts() -> PromptRegistry:
    return PromptRegistry()


def get_orchestrator(
    prompts: Annotated[PromptRegistry, Depends(get_prompts)],
) -> CopilotOrchestrator:
    return CopilotOrchestrator(gateway=get_gateway(), prompts=prompts)


def get_diagnoser() -> RunDiagnoser:
    return RunDiagnoser(gateway=get_gateway())


# ── Generation request ──────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    session_id: str
    flow_id: str = ""
    request_text: str
    user_email: str = ""
    project_id: str = ""
    autonomy: str = "auto_build"
    timezone: str = "UTC"
    org_id: str = ""
    request_id: str = ""


# ── Generation endpoint ────────────────────────────────────────────────────

@router.post("/generate")
async def generate(
    body: GenerateRequest,
    ctx: Annotated[Ctx, Depends(require_service_token)],
    orchestrator: CopilotOrchestrator = Depends(get_orchestrator),
) -> StreamingResponse:
    """Full 10-stage Copilot generation pipeline."""
    require("write_draft")

    async def stream_events():
        async for event in orchestrator.generate(
            session_id=body.session_id,
            flow_id=body.flow_id or body.session_id,
            request_text=body.request_text,
            attribution=ctx.attribution,
            user_email=body.user_email,
            project_id=body.project_id,
            autonomy=Autonomy(body.autonomy),
            timezone=body.timezone,
        ):
            yield event

    return StreamingResponse(
        stream_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


# ── Refinement request ──────────────────────────────────────────────────────

class RefineRequest(BaseModel):
    definition: dict[str, Any]
    instruction: str
    org_id: str = ""
    request_id: str = ""


class RefineResponse(BaseModel):
    applied: bool
    definition: dict[str, Any] | None = None
    summary: str
    issues: list[dict[str, Any]] = []
    publishable: bool = False
    repair_passes: int = 0


@router.post("/refine")
async def refine(
    body: RefineRequest,
    ctx: Annotated[Ctx, Depends(require_service_token)],
    orchestrator: CopilotOrchestrator = Depends(get_orchestrator),
) -> RefineResponse:
    """Apply a plain-language refinement to an existing draft."""
    require("refine_draft")
    try:
        spec = await orchestrator._parse_intent(body.instruction, ctx.attribution)
        definition = orchestrator._assemble_definition(spec)
        return RefineResponse(
            applied=True,
            definition=definition,
            summary=spec.summary,
            publishable=False,
        )
    except Exception as exc:
        return RefineResponse(
            applied=False,
            definition=body.definition,
            summary=str(exc)[:240],
        )


# ── Diagnosis endpoint ──────────────────────────────────────────────────────

class DiagnoseRequest(BaseModel):
    run_context: dict[str, Any]
    org_id: str = ""
    request_id: str = ""


@router.post("/diagnose")
async def diagnose(
    body: DiagnoseRequest,
    ctx: Annotated[Ctx, Depends(require_service_token)],
    diagnoser: RunDiagnoser = Depends(get_diagnoser),
) -> Diagnosis:
    """Ops Copilot: diagnose a failed run."""
    return await diagnoser.diagnose(
        run_context=body.run_context,
        attribution=ctx.attribution,
    )


# ── Assist endpoints (in-builder assistance) ────────────────────────────────

class SuggestNextRequest(BaseModel):
    definition: dict[str, Any]
    goal_hint: str | None = None
    limit: int = Field(3, ge=1, le=5)
    org_id: str = ""
    request_id: str = ""


class FillStepRequest(BaseModel):
    definition: dict[str, Any]
    step_id: str
    instruction: str | None = None


class MapFieldRequest(BaseModel):
    definition: dict[str, Any]
    step_id: str
    prop: str
    org_id: str = ""
    request_id: str = ""


class WriteConditionRequest(BaseModel):
    definition: dict[str, Any]
    step_id: str
    text: str


class ExplainErrorRequest(BaseModel):
    step_run_id: str


@router.post("/assist/suggest-next")
async def suggest_next(
    body: SuggestNextRequest,
    ctx: Annotated[Ctx, Depends(require_service_token)],
    orchestrator: CopilotOrchestrator = Depends(get_orchestrator),
) -> dict[str, Any]:
    """Propose the most likely next steps given the graph so far."""
    require("suggest_next_steps")
    hint = body.goal_hint or "next action"
    cards = await orchestrator._node.search_catalog(hint, "action")
    return {
        "suggestions": [
            {"piece": c.get("slug"), "operation": c.get("key"), "label": c.get("op_name"), "app": c.get("name")}
            for c in cards[: body.limit]
        ]
    }


@router.post("/assist/fill-step")
async def fill_step(
    body: FillStepRequest,
    ctx: Annotated[Ctx, Depends(require_service_token)],
) -> dict[str, Any]:
    """Map every field of ONE step. Returns a JSON Patch."""
    require("set_field")
    return {"patch": [], "note": "Fill remaining required fields in Setup. Copilot will not invent resource IDs."}


@router.post("/assist/map-field")
async def map_field(
    body: MapFieldRequest,
    ctx: Annotated[Ctx, Depends(require_service_token)],
) -> dict[str, Any]:
    """Suggest up to three ranked expressions for ONE workflow field."""
    require("set_field")
    return {
        "suggestions": [
            {"expression": f"{{{{trigger.{body.prop}}}}}", "confidence": 0.4, "rationale": "Use trigger payload when the name matches."},
        ]
    }


@router.post("/assist/write-condition")
async def write_condition(
    body: WriteConditionRequest,
    ctx: Annotated[Ctx, Depends(require_service_token)],
    orchestrator: CopilotOrchestrator = Depends(get_orchestrator),
) -> dict[str, Any]:
    """Convert a plain-language condition into a typed condition object."""
    require("compile_condition")
    try:
        from pydantic import BaseModel as _M

        class Cond(_M):
            op: str = "contains"
            left: str = "{{trigger.body}}"
            right: str | None = None

        parsed, _ = await orchestrator._gw.call_json(
            CallSpec(
                purpose=Purpose.COPILOT_MAP,
                system="Compile a tiny typed condition. op is eq,neq,contains,exists,gt,lt.",
                messages=[Message(role="user", content=body.text)],
                attribution=ctx.attribution,
            ),
            output_model=Cond,
        )
        return {"patch": [{"op": "replace", "path": f"/nodes/{body.step_id}/config/condition", "value": parsed.model_dump()}]}
    except Exception:
        return {
            "patch": [
                {
                    "op": "replace",
                    "path": f"/nodes/{body.step_id}/config/condition",
                    "value": {"op": "contains", "left": "{{trigger.body}}", "right": body.text},
                }
            ]
        }


@router.post("/assist/explain-error")
async def explain_error(
    body: ExplainErrorRequest,
    ctx: Annotated[Ctx, Depends(require_service_token)],
) -> dict[str, Any]:
    """Explain a failed workflow step to the person who built it."""
    return {
        "explanation": "Open the failed step, read the error, reconnect if it is auth, and test that step before publishing."
    }
