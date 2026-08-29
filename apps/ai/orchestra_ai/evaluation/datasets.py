"""
Evaluation Datasets
===================

Standard test scenarios for evaluating Copilot quality.

Every Copilot change should be tested against these scenarios.
Score:
  - intent accuracy
  - operation selection
  - graph correctness
  - mapping correctness
  - mutation minimality (for edits)
  - safety
  - hallucination rate
  - cost
  - latency
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class EvalCase(BaseModel):
    """A single evaluation case."""
    id: str
    category: str  # generate | edit | debug | clarify
    request: str
    context: dict[str, Any] = Field(default_factory=dict)
    expected: dict[str, Any]
    tags: list[str] = Field(default_factory=list)


# ── Generation Cases ──────────────────────────────────────────────────────────

GENERATION_CASES: list[EvalCase] = [
    EvalCase(
        id="gen-001",
        category="generate",
        request="Send Gmail emails to Slack",
        expected={
            "trigger_app": "gmail",
            "trigger_operation": "new_email",
            "action_apps": ["slack"],
            "action_operations": ["send_message"],
            "graph_valid": True,
        },
        tags=["simple", "two-step"],
    ),
    EvalCase(
        id="gen-002",
        category="generate",
        request="When a Typeform response arrives, create a HubSpot contact and notify Slack",
        expected={
            "trigger_app": "typeform",
            "trigger_operation": "new_entry",
            "action_apps": ["hubspot", "slack"],
            "action_operations": ["create_contact", "send_message"],
            "graph_valid": True,
        },
        tags=["three-step", "crm"],
    ),
    EvalCase(
        id="gen-003",
        category="generate",
        request="Every Monday send me a summary of my Google Calendar",
        expected={
            "trigger_app": "schedule",
            "trigger_operation": "cron",
            "action_apps": ["openai", "email"],
            "graph_valid": True,
        },
        tags=["schedule", "ai"],
    ),
    EvalCase(
        id="gen-004",
        category="generate",
        request="When Stripe payment succeeds, notify WhatsApp",
        expected={
            "trigger_app": "stripe",
            "trigger_operation": "new_payment",
            "action_apps": ["whatsapp"],
            "action_operations": ["send_message"],
            "graph_valid": True,
        },
        tags=["payment", "notification"],
    ),
    EvalCase(
        id="gen-005",
        category="generate",
        request="Build a lead routing workflow",
        expected={
            "trigger_app": "webhook",
            "has_ai_step": True,
            "has_condition": True,
            "has_notification": True,
            "graph_valid": True,
        },
        tags=["complex", "ai", "condition"],
    ),
]

# ── Edit Cases ────────────────────────────────────────────────────────────────

EDIT_CASES: list[EvalCase] = [
    EvalCase(
        id="edit-001",
        category="edit",
        request="Add Slack notification after the AI step",
        context={
            "existing_graph": {
                "nodes": [
                    {"id": "trigger", "type": "trigger", "appSlug": "gmail", "operation": "new_email"},
                    {"id": "ai_step", "type": "action", "appSlug": "openai", "operation": "complete"},
                ],
                "edges": [{"id": "e-trigger-ai_step", "source": "trigger", "target": "ai_step"}],
            },
        },
        expected={
            "mutation_type": "add_node",
            "preserves_existing": True,
            "adds_node_app": "slack",
            "graph_valid": True,
        },
        tags=["add-node", "preserve"],
    ),
    EvalCase(
        id="edit-002",
        category="edit",
        request="Replace Slack with WhatsApp",
        context={
            "existing_graph": {
                "nodes": [
                    {"id": "trigger", "type": "trigger", "appSlug": "gmail", "operation": "new_email"},
                    {"id": "slack_step", "type": "action", "appSlug": "slack", "operation": "send_message"},
                ],
                "edges": [{"id": "e-trigger-slack_step", "source": "trigger", "target": "slack_step"}],
            },
        },
        expected={
            "mutation_type": "replace_node",
            "preserves_existing": True,
            "replaces_node_id": "slack_step",
            "new_app": "whatsapp",
            "graph_valid": True,
        },
        tags=["replace", "preserve"],
    ),
    EvalCase(
        id="edit-003",
        category="edit",
        request="Remove the last step",
        context={
            "existing_graph": {
                "nodes": [
                    {"id": "trigger", "type": "trigger", "appSlug": "webhook", "operation": "catch_hook"},
                    {"id": "step1", "type": "action", "appSlug": "openai", "operation": "complete"},
                    {"id": "step2", "type": "action", "appSlug": "slack", "operation": "send_message"},
                ],
                "edges": [
                    {"id": "e-trigger-step1", "source": "trigger", "target": "step1"},
                    {"id": "e-step1-step2", "source": "step1", "target": "step2"},
                ],
            },
        },
        expected={
            "mutation_type": "remove_node",
            "removes_node_id": "step2",
            "preserves_existing": True,
            "graph_valid": True,
        },
        tags=["remove", "preserve"],
    ),
    EvalCase(
        id="edit-004",
        category="edit",
        request="Map the sender email to the contact email",
        context={
            "existing_graph": {
                "nodes": [
                    {"id": "trigger", "type": "trigger", "appSlug": "gmail", "operation": "new_email"},
                    {"id": "crm_step", "type": "action", "appSlug": "hubspot", "operation": "create_contact"},
                ],
                "edges": [{"id": "e-trigger-crm_step", "source": "trigger", "target": "crm_step"}],
            },
        },
        expected={
            "mutation_type": "map_field",
            "target_node": "crm_step",
            "field_mapped": True,
            "graph_valid": True,
        },
        tags=["mapping", "field"],
    ),
]

# ── Debug Cases ───────────────────────────────────────────────────────────────

DEBUG_CASES: list[EvalCase] = [
    EvalCase(
        id="debug-001",
        category="debug",
        request="This workflow failed. Fix it.",
        context={
            "last_error": {"step_id": "slack_step", "error": "channel_not_found"},
            "existing_graph": {
                "nodes": [
                    {"id": "trigger", "type": "trigger", "appSlug": "gmail", "operation": "new_email"},
                    {"id": "slack_step", "type": "action", "appSlug": "slack", "operation": "send_message", "config": {}},
                ],
                "edges": [{"id": "e-trigger-slack_step", "source": "trigger", "target": "slack_step"}],
            },
        },
        expected={
            "diagnoses_error": True,
            "identifies_step": "slack_step",
            "proposes_fix": True,
            "graph_valid": True,
        },
        tags=["fix", "error"],
    ),
    EvalCase(
        id="debug-002",
        category="debug",
        request="Why didn't John get notified?",
        context={
            "last_run": {"status": "succeeded", "trigger": {"email": "john@example.com"}},
            "existing_graph": {
                "nodes": [
                    {"id": "trigger", "type": "trigger", "appSlug": "gmail", "operation": "new_email"},
                    {"id": "filter", "type": "logic", "appSlug": "filter", "operation": "only_continue_if", "config": {"condition": "score > 80"}},
                    {"id": "slack_step", "type": "action", "appSlug": "slack", "operation": "send_message"},
                ],
                "edges": [
                    {"id": "e-trigger-filter", "source": "trigger", "target": "filter"},
                    {"id": "e-filter-slack_step", "source": "filter", "target": "slack_step"},
                ],
            },
        },
        expected={
            "explains_flow": True,
            "identifies_filter": True,
            "confidence_high": True,
        },
        tags=["explain", "filter"],
    ),
]

# ── Clarify Cases ─────────────────────────────────────────────────────────────

CLARIFY_CASES: list[EvalCase] = [
    EvalCase(
        id="clarify-001",
        category="clarify",
        request="Notify me when something happens",
        expected={
            "asks_clarification": True,
            "asks_about": ["trigger", "notification_method"],
            "does_not_guess": True,
        },
        tags=["vague", "ask"],
    ),
    EvalCase(
        id="clarify-002",
        category="clarify",
        request="Do the same thing as yesterday",
        expected={
            "retrieves_context": True,
            "asks_if_unclear": True,
        },
        tags=["context", "reference"],
    ),
]

# ── All Cases ─────────────────────────────────────────────────────────────────

ALL_EVAL_CASES = GENERATION_CASES + EDIT_CASES + DEBUG_CASES + CLARIFY_CASES

def get_cases_by_category(category: str) -> list[EvalCase]:
    """Get all eval cases for a specific category."""
    return [c for c in ALL_EVAL_CASES if c.category == category]

def get_cases_by_tag(tag: str) -> list[EvalCase]:
    """Get all eval cases with a specific tag."""
    return [c for c in ALL_EVAL_CASES if tag in c.tags]

def get_all_case_ids() -> list[str]:
    """Get all case IDs."""
    return [c.id for c in ALL_EVAL_CASES]
