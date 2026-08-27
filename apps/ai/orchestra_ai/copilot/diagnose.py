# ============================================================================
# Orchestra Part 9 — Ops Copilot
# Source of truth: Part 9 § "The Ops Copilot"
# At 03:00, an engineer needs one root cause, its evidence, and a patch.
# Not prose.
# ============================================================================

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, Field

from orchestra_ai.gateway.gateway import CallSpec, Message, ModelGateway, Purpose
from orchestra_ai.schemas.contracts import Attribution


class Diagnosis(BaseModel):
    category: Literal[
        "auth_expired",
        "auth_scope",
        "rate_limited",
        "upstream_outage",
        "upstream_validation",
        "mapping_error",
        "missing_data",
        "logic_error",
        "timeout",
        "sandbox_error",
        "ai_schema",
        "unknown",
    ]
    root_cause: str = Field(..., max_length=400)
    evidence: list[str] = Field(default_factory=list, max_length=6)
    human_fix: str = Field(..., max_length=400)
    patch: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    patch_explanation: str | None = Field(None, max_length=300)
    confidence: float = Field(..., ge=0.0, le=1.0)
    safe_to_auto_apply: bool = False


SYSTEM = """You diagnose a failed workflow run for the engineer who owns it. RULES
Name ONE root cause. If the evidence supports two equally, say so in root_cause and set confidence below 0.5.
evidence must quote actual values from the provided run data. Never invent a log line.
If the cause is external — an expired token, a missing scope, a rate limit, a third-party outage, or a validation error returned BY the third party — return an EMPTY patch and describe the human action instead. A workflow change cannot fix a revoked credential.
Only propose a patch for a cause inside the workflow definition: a wrong field mapping, a wrong condition, a missing default, a too-short timeout.
The patch is RFC 6902 against the DRAFT definition. Never change a step id. Never set connectionId. Never remove a step.
safe_to_auto_apply may be true only for a change that cannot alter which external records are written or which recipients are contacted.
Be concrete. "Check your configuration" is not a diagnosis."""

EXTERNAL_CATEGORIES = {
    "auth_expired", "auth_scope", "rate_limited",
    "upstream_outage", "upstream_validation",
}


class RunDiagnoser:
    """Diagnose a failed run and return a reviewable JSON Patch."""

    def __init__(self, gateway: ModelGateway) -> None:
        self._gw = gateway

    async def diagnose(
        self,
        run_context: dict[str, Any],
        attribution: Attribution,
    ) -> Diagnosis:
        diagnosis, _usage = await self._gw.call_json(
            CallSpec(
                purpose=Purpose.OPS_DIAGNOSE,
                system=SYSTEM,
                messages=[
                    Message(role="user", content=json.dumps(run_context, indent=2, default=str)[:60000])
                ],
                attribution=attribution,
            ),
            output_model=Diagnosis,
        )
        return self._enforce(diagnosis)

    @staticmethod
    def _enforce(d: Diagnosis) -> Diagnosis:
        """Post-conditions the model is not trusted to honour on its own."""
        # External causes should never propose patches
        if d.category in EXTERNAL_CATEGORIES and d.patch:
            d.patch = []
            d.patch_explanation = (
                "No workflow change can fix this. The listed human action is required."
            )
        # Never allow auto-apply for credential or destructive changes
        if d.category in ("auth_expired", "auth_scope"):
            d.safe_to_auto_apply = False
        return d
