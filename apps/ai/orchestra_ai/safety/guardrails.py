"""
AI Guardrails
=============

Classifies risk of every tool call and enforces policies.

Risk levels:
  LOW → automatic
  MEDIUM → optional approval
  HIGH → approval required
  CRITICAL → explicit approval + audit
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class GuardrailResult(BaseModel):
    """Result of a guardrail check."""
    allowed: bool
    risk_level: RiskLevel
    reason: str = ""
    requires_approval: bool = False
    pii_detected: bool = False
    injection_detected: bool = False
    violations: list[str] = Field(default_factory=list)


# ── Risk Classification ─────────────────────────────────────────────────

# Operations classified by risk level
OPERATION_RISK: dict[str, RiskLevel] = {
    # LOW — read-only, no side effects
    "search_contacts": RiskLevel.LOW,
    "list_events": RiskLevel.LOW,
    "find_record": RiskLevel.LOW,
    "list_repos": RiskLevel.LOW,
    "get_form": RiskLevel.LOW,
    "read_sheet": RiskLevel.LOW,
    "list_tables": RiskLevel.LOW,
    "get_automation": RiskLevel.LOW,
    "get_run": RiskLevel.LOW,
    "list_connections": RiskLevel.LOW,

    # MEDIUM — create, no destructive effects
    "send_message": RiskLevel.MEDIUM,
    "send_sms": RiskLevel.MEDIUM,
    "send_email": RiskLevel.MEDIUM,
    "create_contact": RiskLevel.MEDIUM,
    "create_record": RiskLevel.MEDIUM,
    "create_issue": RiskLevel.MEDIUM,
    "create_event": RiskLevel.MEDIUM,
    "create_row": RiskLevel.MEDIUM,
    "append_row": RiskLevel.MEDIUM,
    "create_customer": RiskLevel.MEDIUM,
    "create_ticket": RiskLevel.MEDIUM,
    "create_lead": RiskLevel.MEDIUM,
    "create_page": RiskLevel.MEDIUM,
    "create_card": RiskLevel.MEDIUM,
    "post_tweet": RiskLevel.MEDIUM,
    "create_post": RiskLevel.MEDIUM,

    # HIGH — modify existing data, may affect users
    "update_contact": RiskLevel.HIGH,
    "update_record": RiskLevel.HIGH,
    "update_issue": RiskLevel.HIGH,
    "update_event": RiskLevel.HIGH,
    "update_row": RiskLevel.HIGH,
    "close_issue": RiskLevel.HIGH,
    "merge_pr": RiskLevel.HIGH,
    "send_webhook": RiskLevel.HIGH,
    "complete": RiskLevel.HIGH,  # AI completion can have side effects

    # CRITICAL — destructive, financial, irreversible
    "delete_record": RiskLevel.CRITICAL,
    "delete_event": RiskLevel.CRITICAL,
    "delete_row": RiskLevel.CRITICAL,
    "payment": RiskLevel.CRITICAL,
    "create_payment": RiskLevel.CRITICAL,
    "send_payout": RiskLevel.CRITICAL,
    "turn_off": RiskLevel.CRITICAL,
}


def classify_risk(operation: str, app_slug: str = "") -> RiskLevel:
    """Classify the risk level of an operation."""
    key = operation.lower()
    if key in OPERATION_RISK:
        return OPERATION_RISK[key]
    # Default: medium risk for unknown operations
    return RiskLevel.MEDIUM


# ── PII Detection ───────────────────────────────────────────────────────

PII_PATTERNS = {
    "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"),
    "phone": re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"),
    "ssn": re.compile(r"\b\d{3}[-]\d{2}[-]\d{4}\b"),
    "credit_card": re.compile(r"\b(?:\d{4}[-\s]?){3}\d{4}\b"),
    "ip_address": re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b"),
}


def detect_pii(text: str) -> list[str]:
    """Detect PII in text. Returns list of PII types found."""
    found = []
    pii_type, pattern = PII_PATTERNS.items()
    for pii_type, pattern in PII_PATTERNS.items():
        if pattern.search(text):
            found.append(pii_type)
    return found


def redact_pii(text: str) -> str:
    """Redact PII from text."""
    result = text
    for pii_type, pattern in PII_PATTERNS.items():
        result = pattern.sub(f"[REDACTED_{pii_type.upper()}]", result)
    return result


# ── Prompt Injection Detection ──────────────────────────────────────────

INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+(?:a|an)\s+", re.IGNORECASE),
    re.compile(r"system\s*:\s*", re.IGNORECASE),
    re.compile(r"<\|system\|>", re.IGNORECASE),
    re.compile(r"jailbreak", re.IGNORECASE),
    re.compile(r"DAN\s+mode", re.IGNORECASE),
    re.compile(r"ignore\s+safety", re.IGNORECASE),
    re.compile(r"bypass\s+(?:filter|guard|restriction)", re.IGNORECASE),
]


def detect_injection(text: str) -> bool:
    """Detect potential prompt injection attempts."""
    return any(p.search(text) for p in INJECTION_PATTERNS)


# ── Tool Guardrail ──────────────────────────────────────────────────────

class AgentPolicy(BaseModel):
    """Policy for an agent's tool access."""
    allowed_apps: list[str] = Field(default_factory=list)
    blocked_apps: list[str] = Field(default_factory=list)
    allowed_operations: list[str] = Field(default_factory=list)
    blocked_operations: list[str] = Field(default_factory=list)
    max_steps: int = 8
    max_cost_usd: float = 1.0
    require_approval_for: list[RiskLevel] = Field(default_factory=lambda: [RiskLevel.HIGH, RiskLevel.CRITICAL])


DEFAULT_POLICY = AgentPolicy()


def check_tool_call(
    app_slug: str,
    operation: str,
    arguments: dict[str, Any],
    policy: AgentPolicy | None = None,
) -> GuardrailResult:
    """
    Run all guardrails on a proposed tool call.

    Returns GuardrailResult with allowed/denied + reasons.
    """
    pol = policy or DEFAULT_POLICY
    violations: list[str] = []

    # 1. App allowlist/blocklist
    if pol.allowed_apps and app_slug not in pol.allowed_apps:
        violations.append(f"App '{app_slug}' not in allowlist")
    if app_slug in pol.blocked_apps:
        violations.append(f"App '{app_slug}' is blocked")

    # 2. Operation allowlist/blocklist
    if pol.allowed_operations and operation not in pol.allowed_operations:
        violations.append(f"Operation '{operation}' not in allowlist")
    if operation in pol.blocked_operations:
        violations.append(f"Operation '{operation}' is blocked")

    # 3. Risk classification
    risk = classify_risk(operation, app_slug)
    requires_approval = risk in pol.require_approval_for

    # 4. PII detection in arguments
    pii_found: list[str] = []
    for key, value in arguments.items():
        if isinstance(value, str):
            pii_found.extend(detect_pii(value))

    # 5. Injection detection
    injection = False
    for key, value in arguments.items():
        if isinstance(value, str) and detect_injection(value):
            injection = True
            violations.append(f"Prompt injection detected in '{key}'")

    # 6. Build result
    allowed = len(violations) == 0
    reason = "; ".join(violations) if violations else "OK"

    return GuardrailResult(
        allowed=allowed,
        risk_level=risk,
        reason=reason,
        requires_approval=requires_approval,
        pii_detected=bool(pii_found),
        injection_detected=injection,
        violations=violations,
    )
