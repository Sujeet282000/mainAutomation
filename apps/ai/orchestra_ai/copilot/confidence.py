"""
Confidence Scoring
==================

Provides per-decision confidence instead of a single overall score.

This lets the system know:
  - intent_confidence = 0.97  (high — user was clear)
  - trigger_confidence = 0.99 (high — only one option)
  - operation_confidence = 0.94 (high — matched well)
  - mapping_confidence = 0.62 (low — ask about mapping)
  - connection_confidence = 1.0 (high — account exists)
  - graph_confidence = 0.93 (high — structure is valid)

Then the system asks only about the low-confidence parts.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ConfidenceReport(BaseModel):
    """Per-decision confidence scores."""
    intent: float = Field(0.0, ge=0.0, le=1.0, description="How well we understood the user's goal")
    trigger: float = Field(0.0, ge=0.0, le=1.0, description="How confident we are in the trigger selection")
    operations: float = Field(0.0, ge=0.0, le=1.0, description="How confident we are in action selections")
    mapping: float = Field(0.0, ge=0.0, le=1.0, description="How confident we are in field mappings")
    connections: float = Field(0.0, ge=0.0, le=1.0, description="How well we resolved connections")
    graph: float = Field(0.0, ge=0.0, le=1.0, description="How valid the resulting graph is")
    overall: float = Field(0.0, ge=0.0, le=1.0, description="Weighted overall confidence")

    low_confidence_areas: list[str] = Field(default_factory=list, description="Areas below threshold that need user input")

    def compute_overall(self, weights: dict[str, float] | None = None) -> float:
        """Compute weighted overall confidence."""
        w = weights or {
            "intent": 0.20,
            "trigger": 0.15,
            "operations": 0.25,
            "mapping": 0.15,
            "connections": 0.10,
            "graph": 0.15,
        }
        self.overall = round(
            self.intent * w.get("intent", 0)
            + self.trigger * w.get("trigger", 0)
            + self.operations * w.get("operations", 0)
            + self.mapping * w.get("mapping", 0)
            + self.connections * w.get("connections", 0)
            + self.graph * w.get("graph", 0),
            3,
        )
        return self.overall

    def identify_low_confidence(self, threshold: float = 0.7) -> list[str]:
        """Identify areas below the confidence threshold."""
        areas = []
        scores = {
            "intent": self.intent,
            "trigger": self.trigger,
            "operations": self.operations,
            "mapping": self.mapping,
            "connections": self.connections,
            "graph": self.graph,
        }
        for area, score in scores.items():
            if score < threshold:
                areas.append(area)
        self.low_confidence_areas = areas
        return areas

    def should_ask_user(self, threshold: float = 0.7) -> bool:
        """Whether any area is too uncertain to proceed automatically."""
        return bool(self.identify_low_confidence(threshold))

    def to_summary(self) -> str:
        """Human-readable confidence summary."""
        parts = [f"Overall: {self.overall:.0%}"]
        for area in ["intent", "trigger", "operations", "mapping", "connections", "graph"]:
            score = getattr(self, area)
            indicator = "✓" if score >= 0.7 else "⚠" if score >= 0.4 else "✗"
            parts.append(f"  {indicator} {area}: {score:.0%}")
        return "\n".join(parts)


# ── Confidence Estimators ─────────────────────────────────────────────────────

def estimate_intent_confidence(
    request_text: str,
    parsed_intent: dict | None = None,
) -> float:
    """
    Estimate how well we understood the user's intent.

    Higher when:
    - Request is specific (mentions app names, operations)
    - Request is structured ("do X then Y")
    - Not too ambiguous
    """
    score = 0.5  # baseline

    text = request_text.lower()

    # Specificity: mentions app names
    app_names = ["gmail", "slack", "sheets", "hubspot", "github", "discord", "telegram", "whatsapp", "crm", "notion", "airtable", "trello", "shopify"]
    mentioned = [a for a in app_names if a in text]
    if mentioned:
        score += min(0.2, len(mentioned) * 0.1)

    # Structure: has sequential language
    sequential = ["then", "after that", "next", "followed by", "and then"]
    if any(s in text for s in sequential):
        score += 0.15

    # Clarity: mentions specific operations
    ops = ["send", "create", "notify", "update", "delete", "search", "find", "get", "list", "add"]
    mentioned_ops = [o for o in ops if o in text]
    if mentioned_ops:
        score += min(0.1, len(mentioned_ops) * 0.05)

    # Penalty: very short or vague
    if len(request_text.strip()) < 10:
        score -= 0.2
    if len(request_text.strip()) < 5:
        score -= 0.2

    # Penalty: lots of pronouns without antecedents
    pronouns = ["it", "that", "this", "them", "those"]
    if sum(1 for p in pronouns if p in text) > 2:
        score -= 0.1

    return max(0.0, min(1.0, round(score, 2)))


def estimate_trigger_confidence(
    selected_trigger: dict | None,
    candidates: list[dict] | None = None,
) -> float:
    """Estimate confidence in trigger selection."""
    if not selected_trigger:
        return 0.0
    if not candidates:
        return 0.8  # only one option, high confidence

    # If the selected trigger is the top-ranked, higher confidence
    if candidates[0].get("slug") == selected_trigger.get("slug"):
        # Gap between first and second
        if len(candidates) > 1:
            return 0.9
        return 0.95
    return 0.5


def estimate_operation_confidence(
    selected_ops: list[dict],
    all_ranked: list[list[dict]] | None = None,
) -> float:
    """Estimate confidence in action selections."""
    if not selected_ops:
        return 0.0
    if not all_ranked:
        return 0.8

    # Average position of selected ops in their ranked lists
    scores = []
    for i, op in enumerate(selected_ops):
        if i < len(all_ranked) and all_ranked[i]:
            # If selected is the top candidate
            if all_ranked[i][0].get("slug") == op.get("slug"):
                scores.append(0.9)
            elif any(c.get("slug") == op.get("slug") for c in all_ranked[i][:3]):
                scores.append(0.7)
            else:
                scores.append(0.4)
        else:
            scores.append(0.6)

    return round(sum(scores) / max(len(scores), 1), 2)


def estimate_mapping_confidence(
    mappings: dict[str, str] | None = None,
    required_fields: list[str] | None = None,
) -> float:
    """Estimate confidence in field mappings."""
    if not required_fields:
        return 0.9  # no required fields, high confidence

    if not mappings:
        return 0.0

    mapped_count = sum(1 for f in required_fields if f in mappings and mappings[f])
    return round(mapped_count / len(required_fields), 2) if required_fields else 0.9


def estimate_connection_confidence(
    connections: dict[str, dict] | None = None,
    required_apps: list[str] | None = None,
) -> float:
    """Estimate confidence in connection resolution."""
    if not required_apps:
        return 1.0

    if not connections:
        return 0.0

    resolved = sum(1 for app in required_apps if connections.get(app, {}).get("connection_id"))
    return round(resolved / len(required_apps), 2) if required_apps else 1.0


def estimate_graph_confidence(
    critic_valid: bool,
    issue_count: int = 0,
    warning_count: int = 0,
) -> float:
    """Estimate confidence in the resulting graph."""
    if not critic_valid:
        return max(0.0, 0.5 - issue_count * 0.1)

    score = 1.0
    score -= warning_count * 0.05
    return max(0.0, round(score, 2))
