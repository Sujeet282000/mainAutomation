# ============================================================================
# Orchestra — Python AI Service (FastAPI)
# ============================================================================

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from orchestra_ai.api.agent_routes import router as agent_router
from orchestra_ai.api.routes import router as copilot_router
from orchestra_ai.api.runtime import router as runtime_router
from orchestra_ai.gateway.gateway import (
    AiBudgetExceeded,
    AiSchemaInvalid,
    close_gateway,
    initialise_gateway,
    provider_status,
)
from pydantic import BaseModel, Field


class GenerateWorkflowBody(BaseModel):
    prompt: str
    catalog: list[str] = Field(default_factory=list)
    operations: dict[str, list[str]] = Field(default_factory=dict)


def _keyword_graph(prompt: str) -> dict:
    """Legacy compatibility endpoint. New Copilot uses the agent pipeline."""
    text = prompt.lower()
    trigger = {"id": "t1", "type": "trigger", "appSlug": "webhook", "operation": "catch_hook", "label": "Catch Hook", "position": {"x": 280, "y": 40}, "config": {}, "connectionId": None}
    if any(w in text for w in ("gmail", "inbox", "email")):
        trigger = {**trigger, "appSlug": "gmail", "operation": "new_email", "label": "New email"}
    elif any(w in text for w in ("schedule", "every day", "cron", "every morning")):
        trigger = {**trigger, "appSlug": "schedule", "operation": "cron", "label": "Schedule"}
    elif "form" in text:
        trigger = {**trigger, "appSlug": "forms", "operation": "submitted", "label": "Form submitted"}
    action_slug, action_op, action_label = "http", "request", "HTTP request"
    if "sheet" in text or "spreadsheet" in text:
        action_slug, action_op, action_label = "google-sheets", "create_row", "Add row"
    elif "slack" in text:
        action_slug, action_op, action_label = "slack", "send_message", "Send Slack"
    action = {"id": "a1", "type": "action", "appSlug": action_slug, "operation": action_op, "label": action_label, "position": {"x": 280, "y": 220}, "config": {}, "connectionId": None}
    return {"nodes": [trigger, action], "edges": [{"id": "e1", "source": "t1", "target": "a1"}]}


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await initialise_gateway()
    except Exception as exc:
        print(f"gateway init skipped: {exc}")
    yield
    try:
        await close_gateway()
    except Exception:
        pass


app = FastAPI(title="Orchestra AI Service", version="1.0.0", lifespan=lifespan)
app.include_router(copilot_router)
app.include_router(agent_router)
app.include_router(runtime_router)


@app.post("/v1/generate-workflow")
async def generate_workflow(body: GenerateWorkflowBody):
    """Legacy Node alias. Kept for backwards compatibility."""
    return {"graph": _keyword_graph(body.prompt), "source": "ai-service-legacy"}


@app.get("/health")
async def health():
    status = provider_status()
    return {"ok": True, "service": "ai-service", "providers": status, "mode": status["mode"]}


@app.get("/health/ready")
async def health_ready():
    return {"ok": True, "status": "ready", **provider_status()}


@app.exception_handler(AiBudgetExceeded)
async def budget_exceeded_handler(request, exc):
    return JSONResponse(status_code=429, content={"error": "AI_BUDGET_EXCEEDED", "message": str(exc)})


@app.exception_handler(AiSchemaInvalid)
async def schema_invalid_handler(request, exc):
    return JSONResponse(status_code=422, content={"error": "AI_SCHEMA_INVALID", "message": str(exc)})
