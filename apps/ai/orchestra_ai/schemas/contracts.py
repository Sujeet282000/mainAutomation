# ============================================================================
# Orchestra Part 7 — Canonical schemas and output contracts
# Source of truth: Part 7 § "schemas/ : canonical definitions"
# ============================================================================

from __future__ import annotations

from typing import Annotated, Any, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ── Wire model (camelCase JSON, forbid extras) ──────────────────────────────

class WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# ── JSON value ──────────────────────────────────────────────────────────────

JsonValue: TypeAlias = str | int | float | bool | None | list[Any] | dict[str, Any]


# ── Piece reference ─────────────────────────────────────────────────────────

class PieceRef(WireModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_-]*$")
    version: str = Field(default="*")


# ── Condition ───────────────────────────────────────────────────────────────

class ConditionLeaf(WireModel):
    op: Literal[
        "eq", "neq", "gt", "gte", "lt", "lte",
        "contains", "not_contains", "starts_with", "ends_with",
        "exists", "not_exists", "matches", "in",
        "not_in", "is_empty", "is_not_empty",
    ]
    left: JsonValue
    right: JsonValue | None = None


class ConditionCompound(WireModel):
    op: Literal["and", "or"]
    operands: list["Condition"]


class ConditionNot(WireModel):
    op: Literal["not"]
    operand: "Condition"


Condition: TypeAlias = ConditionLeaf | ConditionCompound | ConditionNot


# ── Retry policy ────────────────────────────────────────────────────────────

class RetryPolicy(WireModel):
    maxAttempts: int = Field(default=3, ge=1, le=10)
    backoff: Literal["fixed", "exponential"] = "exponential"
    initialDelayMs: int = Field(default=1000, ge=100, le=300_000)
    maxDelayMs: int = Field(default=60_000, ge=100, le=3_600_000)
    retryOn: list[Literal["transient", "auth", "budget"]] = Field(
        default=["transient"]
    )


# ── Step base ───────────────────────────────────────────────────────────────

class StepBase(WireModel):
    id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,99}$")
    name: str = Field(min_length=1, max_length=200)
    retry: RetryPolicy | None = None
    onError: str | None = None


# ── Step types ──────────────────────────────────────────────────────────────

class PieceActionStep(StepBase):
    type: Literal["piece_action"]
    piece: PieceRef
    operation: str
    connectionId: str | None = None
    props: dict[str, JsonValue] = Field(default_factory=dict)


class HttpStep(StepBase):
    type: Literal["http"]
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]
    url: str
    headers: dict[str, JsonValue] = Field(default_factory=dict)
    body: JsonValue | None = None


class CodeStep(StepBase):
    type: Literal["code"]
    source: str = Field(min_length=1)
    inputs: dict[str, JsonValue] = Field(default_factory=dict)
    timeoutMs: int = Field(default=15_000, ge=100, le=60_000)


class AiStep(StepBase):
    type: Literal["ai"]
    operation: Literal["generate", "summarize", "classify", "extract", "embed"]
    model: str | Literal["auto"] = "auto"
    props: dict[str, JsonValue] = Field(default_factory=dict)


class AgentStep(StepBase):
    type: Literal["agent"]
    model: str | Literal["auto"] = "auto"
    instructions: str = Field(min_length=1)
    tools: list[dict[str, JsonValue]] = Field(default_factory=list)
    maxIterations: int = Field(default=8, ge=1, le=30)
    maxCreditBudget: int = Field(ge=1)


class FilterStep(StepBase):
    type: Literal["filter"]
    condition: Condition


class BranchStep(StepBase):
    type: Literal["branch"]
    condition: Condition
    onTrue: list["Step"] = Field(default_factory=list)
    onFalse: list["Step"] = Field(default_factory=list)


class RouterBranch(WireModel):
    id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,99}$")
    condition: Condition | None = None
    default: bool = False
    steps: list["Step"] = Field(default_factory=list)


class RouterStep(StepBase):
    type: Literal["router"]
    branches: list[RouterBranch] = Field(min_length=1)

    @model_validator(mode="after")
    def one_default_at_most(self) -> "RouterStep":
        if sum(branch.default for branch in self.branches) > 1:
            raise ValueError("router has more than one default branch")
        return self


class LoopStep(StepBase):
    type: Literal["loop"]
    props: dict[str, JsonValue] = Field(default_factory=dict)
    steps: list["Step"] = Field(default_factory=list)


class DelayStep(StepBase):
    type: Literal["delay"]
    props: dict[str, JsonValue] = Field(default_factory=dict)


class ApprovalStep(StepBase):
    type: Literal["approval"]
    props: dict[str, JsonValue] = Field(default_factory=dict)


class DataTableStep(StepBase):
    type: Literal["data_table"]
    props: dict[str, JsonValue] = Field(default_factory=dict)


class NoteStep(StepBase):
    type: Literal["note"]
    content: str


class SubFlowStep(StepBase):
    type: Literal["sub_flow"]
    flowId: str
    props: dict[str, JsonValue] = Field(default_factory=dict)


# ── Union ───────────────────────────────────────────────────────────────────

Step: TypeAlias = Annotated[
    PieceActionStep | HttpStep | CodeStep | AiStep | AgentStep | FilterStep
    | BranchStep | RouterStep | LoopStep | DelayStep | ApprovalStep
    | DataTableStep | NoteStep | SubFlowStep,
    Field(discriminator="type"),
]


# ── Trigger ─────────────────────────────────────────────────────────────────

class TriggerDef(WireModel):
    id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,99}$")
    type: Literal["app_event", "schedule", "webhook", "form", "manual"]
    piece: PieceRef | None = None
    operation: str | None = None
    connectionId: str | None = None
    props: dict[str, JsonValue] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_piece_trigger(self) -> "TriggerDef":
        app_event = self.type == "app_event"
        if app_event != (self.piece is not None and self.operation is not None):
            raise ValueError(
                "app_event requires piece and operation; other triggers do not"
            )
        return self


# ── Flow settings ───────────────────────────────────────────────────────────

class ErrorHandling(WireModel):
    mode: Literal["fail", "continue"] = "fail"


class FlowSettings(WireModel):
    timezone: str = "UTC"
    concurrency: int = Field(default=1, ge=1, le=100)
    errorHandling: ErrorHandling = Field(default_factory=ErrorHandling)


# ── Flow definition ─────────────────────────────────────────────────────────

class FlowDefinition(WireModel):
    schemaVersion: Literal[1]
    trigger: TriggerDef
    steps: list[Step] = Field(default_factory=list)
    settings: FlowSettings

    @model_validator(mode="after")
    def unique_step_ids(self) -> "FlowDefinition":
        seen: set[str] = {self.trigger.id}

        def visit(items: list[Step]) -> None:
            for step in items:
                if step.id in seen:
                    raise ValueError(f"duplicate step id: {step.id}")
                seen.add(step.id)
                if isinstance(step, BranchStep):
                    visit(step.onTrue)
                    visit(step.onFalse)
                elif isinstance(step, RouterStep):
                    for branch in step.branches:
                        visit(branch.steps)
                elif isinstance(step, LoopStep):
                    visit(step.steps)

        visit(self.steps)
        return self


# ── Operation card (for catalog retrieval) ──────────────────────────────────

class OperationCard(WireModel):
    """One retrievable catalog entry. Mirrors a piece_operations row."""
    operation_id: str
    piece_name: str
    piece_version: str
    piece_display_name: str
    kind: Literal["trigger", "action", "search"]
    operation_name: str
    display_name: str
    description: str
    auth_type: str
    side_effect: Literal["read", "write", "none"] = "read"
    props_summary: list[str] = Field(default_factory=list)
    sample_output_keys: list[str] = Field(default_factory=list)
    score: float = 0.0


# ── Usage record ────────────────────────────────────────────────────────────

class Usage(WireModel):
    provider: str
    model: str
    purpose: str
    tokensIn: int = 0
    tokensOut: int = 0
    cachedTokens: int = 0
    costUsd: float = 0.0
    latencyMs: int = 0
    byoKey: bool = False


# ── Attribution ─────────────────────────────────────────────────────────────

class Attribution(WireModel):
    org_id: str
    request_id: str
    user_id: str | None = None
    flow_id: str | None = None
    run_id: str | None = None
