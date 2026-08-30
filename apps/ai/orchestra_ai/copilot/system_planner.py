"""
System Planner
==============

Sits ABOVE the existing Workflow Planner (Level 2).
This is Level 1 — it answers:

  "What products/capabilities does this user need?"

Then it routes to the right editor/surface.

Architecture:

  User request
       ↓
  System Planner (this module)
       ↓
  Product Router
       ↓
  ┌─────────┼──────────┐
   Form    Flow      Canvas
    │        │          │
    └────────┼──────────┘
             ↓
       Resource Graph
             ↓
       Create + Connect
             ↓
       Validate
             ↓
       Open UI

The existing copilot orchestrator handles Level 2 (workflow building).
This module handles Level 1 (system understanding).
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ── Product Types ────────────────────────────────────────────────────────────

class ProductType(str, Enum):
    FORM = "form"
    TABLE = "table"
    WORKFLOW = "workflow"
    AGENT = "agent"
    CHATBOT = "chatbot"
    INTERFACE = "interface"
    CONNECTION = "connection"


class CapabilityType(str, Enum):
    COLLECT = "collect"          # Form/webhook intake
    STORE = "store"              # Table/database storage
    TRIGGER = "trigger"          # Event-driven start
    TRANSFORM = "transform"      # AI/data transformation
    DECIDE = "decide"            # Condition/branch
    ROUTE = "route"              # Send to correct destination
    NOTIFY = "notify"            # Slack/email/SMS
    SEARCH = "search"            # Look up existing data
    ENRICH = "enrich"            # AI enrichment/scoring
    APPROVE = "approve"          # Human-in-the-loop
    SCHEDULE = "schedule"        # Time-based trigger
    EXECUTE = "execute"          # External API call


class EntrySurface(str, Enum):
    FORM_BUILDER = "form_builder"
    FLOW_BUILDER = "flow_builder"
    CANVAS = "canvas"
    TABLE_BUILDER = "table_builder"
    AGENT_BUILDER = "agent_builder"
    CHATBOT_BUILDER = "chatbot_builder"


# ── Data Models ──────────────────────────────────────────────────────────────

class IdentifiedCapability(BaseModel):
    """A single capability the user needs."""
    type: CapabilityType
    description: str
    product: ProductType
    app_hint: str | None = None       # e.g. "slack", "gmail", "google-sheets"
    order: int = 0
    depends_on: list[int] = Field(default_factory=list)  # indices of capabilities this depends on


class SystemPlan(BaseModel):
    """Complete system-level plan for a user request."""
    goal: str
    summary: str
    capabilities: list[IdentifiedCapability]
    products_used: list[ProductType]
    entry_surface: EntrySurface
    primary_product: ProductType
    resource_graph: list[dict[str, Any]] = Field(default_factory=list)
    needs_connections: list[str] = Field(default_factory=list)
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    reasoning: str = ""
    is_single_product: bool = True
    recommended_actions: list[str] = Field(default_factory=list)


# ── Intent Signal Patterns ───────────────────────────────────────────────────

_COLLECT_SIGNALS = {
    CapabilityType.COLLECT: [
        r"\b(form|submit|submission|intake|capture|collect|sign.?up|register|webhook|catch hook|http post|receive|collected|captures?)\b",
    ],
    CapabilityType.STORE: [
        r"\b(store|save|record|database|table|crm|sheet|spreadsheet|row|log|add to|put in|write to|persist|stored|saving?)\b",
    ],
    CapabilityType.TRIGGER: [
        r"\b(when|whenever|on new|every time|trigger|start|each time)\b",
    ],
    CapabilityType.TRANSFORM: [
        r"\b(ai|classify|classify|analyze|summar|score|extract|parse|transform|enrich|qualif|identify|determine|qualified?|scoring?)\b",
    ],
    CapabilityType.DECIDE: [
        r"\b(if|else|condition|branch|route|path|filter|hot|warm|cold|scored?|only when|unless|depending on|decided?)\b",
    ],
    CapabilityType.ROUTE: [
        r"\b(send to|route to|forward|assign|distribute|escalat|routed?|sent to|sales)\b",
    ],
    CapabilityType.NOTIFY: [
        r"\b(notif|alert|messag|slack|email|sms|whatsapp|telegram|discord|tell|inform|let know|remind|notified?)\b",
    ],
    CapabilityType.SEARCH: [
        r"\b(search|find|lookup|check.*exist|check.*already)\b",
    ],
    CapabilityType.ENRICH: [
        r"\b(enrich|augment|score|rank|prioritiz|lead score)\b",
    ],
    CapabilityType.APPROVE: [
        r"\b(approve|confirm|review|human|approval|ask me)\b",
    ],
    CapabilityType.SCHEDULE: [
        r"\b(schedule|daily|weekly|monthly|every|cron|periodic)\b",
    ],
    CapabilityType.EXECUTE: [
        r"\b(call api|http request|post to|update.*api|create.*record)\b",
    ],
}

_PRODUCT_HINTS: dict[ProductType, list[re.Pattern]] = {}  # filled below

import re

for _pt, _patterns in [
    (ProductType.FORM, [r"\b(form|submission|intake|capture form|web form)\b"]),
    (ProductType.TABLE, [r"\b(table|database|crm|sheet|spreadsheet|row|record|store|stored)\b"]),
    (ProductType.WORKFLOW, [r"\b(automat|workflow|zap|pipeline|flow|process)\b"]),
    (ProductType.AGENT, [r"\b(agent|ai agent|autonomous|tool.?call|reason)\b"]),
    (ProductType.CHATBOT, [r"\b(chatbot|chat bot|assistant|support bot|qa bot)\b"]),
    (ProductType.INTERFACE, [r"\b(dashboard|interface|view|ui|portal|app)\b"]),
]:
    _PRODUCT_HINTS[_pt] = [re.compile(p, re.IGNORECASE) for p in _patterns]

_CAPABILITY_PATTERNS: dict[CapabilityType, list[re.Pattern]] = {
    cap: [re.compile(p, re.IGNORECASE) for p in patterns]
    for cap, patterns in _COLLECT_SIGNALS.items()
}


def _detect_capabilities(prompt: str) -> list[IdentifiedCapability]:
    """Detect capabilities from a natural language prompt."""
    caps: list[IdentifiedCapability] = []
    seen: set[CapabilityType] = set()

    for cap_type, patterns in _CAPABILITY_PATTERNS.items():
        for pat in patterns:
            if pat.search(prompt):
                if cap_type not in seen:
                    seen.add(cap_type)
                    caps.append(IdentifiedCapability(
                        type=cap_type,
                        description=cap_type.value.replace("_", " ").title(),
                        product=_capability_to_product(cap_type),
                        order=len(caps),
                    ))
                break

    return caps


def _capability_to_product(cap: CapabilityType) -> ProductType:
    """Map a capability to its primary product."""
    mapping = {
        CapabilityType.COLLECT: ProductType.FORM,
        CapabilityType.STORE: ProductType.TABLE,
        CapabilityType.TRIGGER: ProductType.WORKFLOW,
        CapabilityType.TRANSFORM: ProductType.WORKFLOW,
        CapabilityType.DECIDE: ProductType.WORKFLOW,
        CapabilityType.ROUTE: ProductType.WORKFLOW,
        CapabilityType.NOTIFY: ProductType.WORKFLOW,
        CapabilityType.SEARCH: ProductType.TABLE,
        CapabilityType.ENRICH: ProductType.WORKFLOW,
        CapabilityType.APPROVE: ProductType.WORKFLOW,
        CapabilityType.SCHEDULE: ProductType.WORKFLOW,
        CapabilityType.EXECUTE: ProductType.WORKFLOW,
    }
    return mapping.get(cap, ProductType.WORKFLOW)


def _detect_products(prompt: str) -> list[ProductType]:
    """Detect which products are needed from the prompt."""
    products: list[ProductType] = []
    for pt, patterns in _PRODUCT_HINTS.items():
        for pat in patterns:
            if pat.search(prompt):
                products.append(pt)
                break
    return products


def _detect_connections(prompt: str) -> list[str]:
    """Detect which integrations/connections are needed."""
    import re as _re
    connections: list[str] = []
    app_patterns = [
        (r"\b(slack)\b", "slack"),
        (r"\b(gmail|email)\b", "gmail"),
        (r"\b(google sheet|sheets?|spreadsheet)\b", "google-sheets"),
        (r"\b(google calendar|calendar)\b", "google-calendar"),
        (r"\b(hubspot|crm)\b", "hubspot"),
        (r"\b(salesforce)\b", "salesforce"),
        (r"\b(notion)\b", "notion"),
        (r"\b(github)\b", "github"),
        (r"\b(stripe|payment)\b", "stripe"),
        (r"\b(whatsapp)\b", "whatsapp"),
        (r"\b(telegram)\b", "telegram"),
        (r"\b(discord)\b", "discord"),
        (r"\b(twilio|sms)\b", "twilio"),
    ]
    for pat, slug in app_patterns:
        if _re.search(pat, prompt, _re.IGNORECASE):
            if slug not in connections:
                connections.append(slug)
    return connections


def _determine_entry_surface(
    products: list[ProductType],
    capabilities: list[IdentifiedCapability],
) -> EntrySurface:
    """Decide which editor/surface the user should start in."""
    product_set = set(products)

    # Multi-product system → Canvas
    if len(product_set) >= 3:
        return EntrySurface.CANVAS

    # Form + Table tightly coupled → Form Builder
    if ProductType.FORM in product_set and ProductType.TABLE in product_set and len(product_set) == 2:
        return EntrySurface.FORM_BUILDER

    # Chatbot → Chatbot Builder
    if ProductType.CHATBOT in product_set:
        return EntrySurface.CHATBOT_BUILDER

    # Agent → Agent Builder
    if ProductType.AGENT in product_set and ProductType.WORKFLOW not in product_set:
        return EntrySurface.AGENT_BUILDER

    # Table only → Table Builder
    if ProductType.TABLE in product_set and len(product_set) == 1:
        return EntrySurface.TABLE_BUILDER

    # Form only → Form Builder
    if ProductType.FORM in product_set and len(product_set) == 1:
        return EntrySurface.FORM_BUILDER

    # Default: Canvas for complex, Flow Builder for simple
    if len(capabilities) >= 4:
        return EntrySurface.CANVAS
    return EntrySurface.FLOW_BUILDER


def _build_resource_graph(
    capabilities: list[IdentifiedCapability],
    connections: list[str],
) -> list[dict[str, Any]]:
    """Build a resource graph showing how resources connect."""
    graph: list[dict[str, Any]] = []
    for i, cap in enumerate(capabilities):
        node = {
            "index": i,
            "product": cap.product.value,
            "capability": cap.type.value,
            "description": cap.description,
            "app_hint": cap.app_hint,
            "depends_on": cap.depends_on,
        }
        graph.append(node)

    # Add connection nodes
    for i, conn in enumerate(connections):
        graph.append({
            "index": len(capabilities) + i,
            "product": "connection",
            "capability": "notify" if conn in ("slack", "gmail", "telegram", "discord") else "execute",
            "description": f"{conn.title()} integration",
            "app_hint": conn,
            "depends_on": [len(capabilities) - 1],  # depends on last capability
        })

    return graph


# ── Main Entry Point ─────────────────────────────────────────────────────────

def plan_system(
    prompt: str,
    existing_context: dict[str, Any] | None = None,
) -> SystemPlan:
    """
    Analyze a user request and produce a system-level plan.

    This is Level 1 planning — it identifies WHAT the user needs,
    not HOW to implement it in the workflow engine.
    """
    capabilities = _detect_capabilities(prompt)
    products = _detect_products(prompt)
    connections = _detect_connections(prompt)

    # Ensure products cover all capability needs
    cap_products = {_capability_to_product(c.type) for c in capabilities}
    for p in cap_products:
        if p not in products:
            products.append(p)

    entry_surface = _determine_entry_surface(products, capabilities)
    resource_graph = _build_resource_graph(capabilities, connections)

    # Determine primary product
    if ProductType.WORKFLOW in products:
        primary = ProductType.WORKFLOW
    elif products:
        primary = products[0]
    else:
        primary = ProductType.WORKFLOW

    is_single = len(set(products)) <= 1 and len(capabilities) <= 2

    # Build summary
    cap_names = [c.type.value.replace("_", " ") for c in capabilities]
    summary_parts = []
    if ProductType.FORM in products:
        summary_parts.append("Form for data collection")
    if ProductType.TABLE in products:
        summary_parts.append("Table for storage")
    if ProductType.WORKFLOW in products:
        summary_parts.append("Workflow for automation")
    if ProductType.AGENT in products:
        summary_parts.append("AI Agent for reasoning")
    if ProductType.CHATBOT in products:
        summary_parts.append("Chatbot for user interaction")

    summary = " + ".join(summary_parts) if summary_parts else "Automation workflow"

    # Build recommended actions
    actions: list[str] = []
    if ProductType.FORM in products:
        actions.append("Create a form to collect data")
    if ProductType.TABLE in products:
        actions.append("Create a table to store records")
    if ProductType.WORKFLOW in products:
        actions.append("Create an automation workflow")
    if ProductType.AGENT in products:
        actions.append("Create an AI agent for intelligent processing")
    if connections:
        actions.append(f"Connect to: {', '.join(connections)}")

    return SystemPlan(
        goal=prompt[:200],
        summary=summary,
        capabilities=capabilities,
        products_used=products,
        entry_surface=entry_surface,
        primary_product=primary,
        resource_graph=resource_graph,
        needs_connections=connections,
        confidence=min(0.9, 0.5 + len(capabilities) * 0.08),
        reasoning=f"Detected {len(capabilities)} capabilities across {len(products)} products",
        is_single_product=is_single,
        recommended_actions=actions,
    )
