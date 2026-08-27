# ============================================================================
# Orchestra Part 8 — Copilot Pipeline Data Contracts
# Source of truth: Part 8 § "Pipeline data contracts"
# ============================================================================

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class Stage(str, Enum):
    INTENT = "intent"
    RETRIEVE = "retrieve"
    SELECT = "select"
    CONNECTIONS = "connections"
    SCHEMAS = "schemas"
    MAPPING = "mapping"
    ASSEMBLE = "assemble"
    VALIDATE = "validate"
    REPAIR = "repair"
    PERSIST = "persist"


class Autonomy(str, Enum):
    AUTO_BUILD = "auto_build"
    ASK_AS_YOU_BUILD = "ask_as_you_build"


class TriggerIntent(BaseModel):
    kind: str  # app_event | schedule | webhook | form | manual
    app_hint: str | None = None
    event_hint: str | None = None
    search_text: str = ""
    schedule_hint: str | None = None


class ActionIntent(BaseModel):
    purpose: str
    operation_hint: str
    order: int


class LogicIntent(BaseModel):
    kind: str  # filter | branch | router | loop | delay | approval
    after_order: int = Field(..., ge=-1, description="-1 means immediately after trigger")
    description: str
    condition_text: str | None = None


class Ambiguity(BaseModel):
    field: str
    question: str
    assumption: str | None = Field(
        None, description="What auto_build will assume if the user is not asked"
    )
    blocking: bool = False


class IntentSpec(BaseModel):
    summary: str = Field(..., max_length=200)
    trigger: TriggerIntent
    actions: list[ActionIntent] = Field(default_factory=list)
    logic: list[LogicIntent] = Field(default_factory=list)
    ambiguities: list[Ambiguity] = Field(default_factory=list)
    out_of_scope: list[str] = Field(
        default_factory=list,
        description="Requested things this platform cannot do",
    )

    @field_validator("actions")
    @classmethod
    def _dense_order(cls, v: list[ActionIntent]) -> list[ActionIntent]:
        ordered = sorted(v, key=lambda a: a.order)
        for i, a in enumerate(ordered):
            a.order = i
        return ordered


class Selection(BaseModel):
    operation_id: str | None
    confidence: float = Field(..., ge=0.0, le=1.0)
    reason: str
    abstained: bool = False


class ConnectionChoice(BaseModel):
    piece_name: str
    connection_id: str | None = None
    connection_label: str | None = None
    strategy: str = "needs_human"  # email_match | most_used | only_accessible | needs_human
    needs_human: bool = True


class FieldMapping(BaseModel):
    prop: str
    value: Any | None = None
    expression: str | None = None
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    source: str = "abstained"  # expression | literal | default | abstained
    note: str | None = None


class StepMapping(BaseModel):
    step_id: str
    mappings: list[FieldMapping] = Field(default_factory=list)
    unmapped_required: list[str] = Field(default_factory=list)


class Todo(BaseModel):
    kind: str  # connect_account | fill_field | clarify | unsupported
    step_id: str | None = None
    prop: str | None = None
    message: str
    severity: str = "advisory"  # advisory | blocking


class GenerationResult(BaseModel):
    session_id: str
    flow_id: str
    definition: dict[str, Any]
    todos: list[Todo]
    issues: list[dict[str, Any]]
    publishable: bool
    repair_passes: int
    confidence: float
    cost_usd: float = 0.0
    elapsed_ms: int = 0
