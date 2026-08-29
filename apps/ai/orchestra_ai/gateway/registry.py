"""
Model Registry
==============

Task-based model routing using capability profiles.

Instead of hardcoding "use GPT-4 for everything", the system selects
the best model based on:
  - Task requirements (reasoning, coding, structured output, etc.)
  - Cost constraints
  - Latency requirements
  - Provider availability
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Capability(str, Enum):
    REASONING = "reasoning"
    TOOL_USE = "tool_use"
    CODING = "coding"
    STRUCTURED_OUTPUT = "structured_output"
    LONG_CONTEXT = "long_context"
    MULTIMODAL = "multimodal"
    SPEED = "speed"
    COST_EFFICIENCY = "cost_efficiency"


class TaskTier(str, Enum):
    """Deterministic tasks — no LLM needed."""
    DETERMINISTIC = "deterministic"
    """Fast AI — classification, extraction, simple mapping."""
    FAST = "fast"
    """Standard reasoning — workflow generation, modification, troubleshooting."""
    STANDARD = "standard"
    """Frontier reasoning — complex workflows, ambiguous multi-app requirements."""
    FRONTIER = "frontier"
    """Specialist — research, browser, coding, multimodal."""
    SPECIALIST = "specialist"


@dataclass(frozen=True)
class ModelProfile:
    """A model's capability profile."""
    provider: str
    model: str
    capabilities: dict[str, int]  # capability → score 0-10
    cost_input_per_m: float       # cost per million input tokens
    cost_output_per_m: float      # cost per million output tokens
    supports: list[str] = field(default_factory=lambda: ["tools", "structured_output"])
    max_context: int = 128_000
    tier: TaskTier = TaskTier.STANDARD


# ── Model Profiles ───────────────────────────────────────────────────────

MODEL_PROFILES: list[ModelProfile] = [
    # OpenAI models
    ModelProfile(
        provider="openai", model="gpt-5.6-luna",
        capabilities={"reasoning": 9, "tool_use": 9, "coding": 8, "structured_output": 10, "long_context": 9, "multimodal": 8, "speed": 10, "cost_efficiency": 8},
        cost_input_per_m=2.50, cost_output_per_m=10.00,
        supports=["tools", "structured_output", "parallel_tools", "prompt_cache"],
        max_context=1_000_000, tier=TaskTier.FRONTIER,
    ),
    ModelProfile(
        provider="openai", model="gpt-5.6-sol",
        capabilities={"reasoning": 10, "tool_use": 9, "coding": 9, "structured_output": 10, "long_context": 10, "multimodal": 9, "speed": 7, "cost_efficiency": 5},
        cost_input_per_m=10.00, cost_output_per_m=40.00,
        supports=["tools", "structured_output", "parallel_tools", "prompt_cache"],
        max_context=1_000_000, tier=TaskTier.FRONTIER,
    ),
    ModelProfile(
        provider="openai", model="gpt-4.1",
        capabilities={"reasoning": 8, "tool_use": 9, "coding": 8, "structured_output": 9, "long_context": 8, "multimodal": 7, "speed": 8, "cost_efficiency": 7},
        cost_input_per_m=2.00, cost_output_per_m=8.00,
        supports=["tools", "structured_output"],
        max_context=1_048_576, tier=TaskTier.STANDARD,
    ),
    ModelProfile(
        provider="openai", model="gpt-4.1-mini",
        capabilities={"reasoning": 6, "tool_use": 7, "coding": 6, "structured_output": 8, "long_context": 7, "multimodal": 6, "speed": 9, "cost_efficiency": 9},
        cost_input_per_m=0.40, cost_output_per_m=1.60,
        supports=["tools", "structured_output"],
        max_context=1_048_576, tier=TaskTier.FAST,
    ),
    # Anthropic models
    ModelProfile(
        provider="anthropic", model="claude-opus-4-6",
        capabilities={"reasoning": 10, "tool_use": 10, "coding": 10, "structured_output": 9, "long_context": 10, "multimodal": 9, "speed": 6, "cost_efficiency": 3},
        cost_input_per_m=15.00, cost_output_per_m=75.00,
        supports=["tools", "structured_output", "extended_thinking"],
        max_context=200_000, tier=TaskTier.FRONTIER,
    ),
    ModelProfile(
        provider="anthropic", model="claude-sonnet-4-6",
        capabilities={"reasoning": 9, "tool_use": 9, "coding": 9, "structured_output": 9, "long_context": 9, "multimodal": 8, "speed": 8, "cost_efficiency": 7},
        cost_input_per_m=3.00, cost_output_per_m=15.00,
        supports=["tools", "structured_output", "extended_thinking"],
        max_context=200_000, tier=TaskTier.STANDARD,
    ),
    ModelProfile(
        provider="anthropic", model="claude-sonnet-4-5",
        capabilities={"reasoning": 8, "tool_use": 8, "coding": 8, "structured_output": 8, "long_context": 8, "multimodal": 7, "speed": 8, "cost_efficiency": 7},
        cost_input_per_m=3.00, cost_output_per_m=15.00,
        supports=["tools", "structured_output"],
        max_context=200_000, tier=TaskTier.STANDARD,
    ),
    # Google models
    ModelProfile(
        provider="google", model="gemini-3.7-flash",
        capabilities={"reasoning": 7, "tool_use": 8, "coding": 7, "structured_output": 8, "long_context": 9, "multimodal": 9, "speed": 10, "cost_efficiency": 10},
        cost_input_per_m=0.075, cost_output_per_m=0.30,
        supports=["tools", "structured_output", "code_execution", "search"],
        max_context=1_000_000, tier=TaskTier.FAST,
    ),
    ModelProfile(
        provider="google", model="gemini-3.1-pro",
        capabilities={"reasoning": 9, "tool_use": 9, "coding": 8, "structured_output": 9, "long_context": 10, "multimodal": 10, "speed": 7, "cost_efficiency": 8},
        cost_input_per_m=1.25, cost_output_per_m=5.00,
        supports=["tools", "structured_output", "code_execution", "search", "computer_use"],
        max_context=2_000_000, tier=TaskTier.FRONTIER,
    ),
]


# ── Task → Model Router ──────────────────────────────────────────────────

TASK_TIER_MAP: dict[str, TaskTier] = {
    # Deterministic (no LLM)
    "validate_graph": TaskTier.DETERMINISTIC,
    "validate_schema": TaskTier.DETERMINISTIC,
    "check_types": TaskTier.DETERMINISTIC,
    "check_permissions": TaskTier.DETERMINISTIC,
    "known_mapping": TaskTier.DETERMINISTIC,

    # Fast AI
    "classify": TaskTier.FAST,
    "extract": TaskTier.FAST,
    "simple_mapping": TaskTier.FAST,
    "rewrite": TaskTier.FAST,
    "summarize": TaskTier.FAST,
    "intent_detection": TaskTier.FAST,
    "select_operation": TaskTier.FAST,

    # Standard reasoning
    "workflow_generation": TaskTier.STANDARD,
    "workflow_modification": TaskTier.STANDARD,
    "troubleshooting": TaskTier.STANDARD,
    "field_mapping": TaskTier.STANDARD,
    "business_logic": TaskTier.STANDARD,
    "copilot_plan": TaskTier.STANDARD,
    "copilot_refine": TaskTier.STANDARD,
    "copilot_repair": TaskTier.STANDARD,
    "agent_loop": TaskTier.STANDARD,

    # Frontier reasoning
    "complex_workflow": TaskTier.FRONTIER,
    "ambiguous_requirements": TaskTier.FRONTIER,
    "graph_redesign": TaskTier.FRONTIER,
    "difficult_debugging": TaskTier.FRONTIER,
    "multi_agent_planning": TaskTier.FRONTIER,

    # Specialist
    "research": TaskTier.SPECIALIST,
    "browser_automation": TaskTier.SPECIALIST,
    "code_generation": TaskTier.SPECIALIST,
    "data_analysis": TaskTier.SPECIALIST,
    "document_processing": TaskTier.SPECIALIST,
    "multimodal": TaskTier.SPECIALIST,
}


def select_model(
    task: str,
    *,
    max_cost_per_m: float | None = None,
    require_capabilities: list[str] | None = None,
    prefer_provider: str | None = None,
) -> ModelProfile | None:
    """
    Select the best model for a given task.

    Uses task tier mapping + capability scoring + cost filtering.
    """
    tier = TASK_TIER_MAP.get(task, TaskTier.STANDARD)

    candidates = [p for p in MODEL_PROFILES if p.tier == tier]
    if not candidates:
        candidates = MODEL_PROFILES  # fallback to all

    # Filter by cost
    if max_cost_per_m is not None:
        candidates = [p for p in candidates if p.cost_input_per_m <= max_cost_per_m]

    # Filter by required capabilities
    if require_capabilities:
        def has_caps(p: ModelProfile) -> bool:
            return all(p.capabilities.get(c, 0) >= 7 for c in require_capabilities)
        filtered = [p for p in candidates if has_caps(p)]
        if filtered:
            candidates = filtered

    # Prefer provider
    if prefer_provider:
        provider_matches = [p for p in candidates if p.provider == prefer_provider]
        if provider_matches:
            candidates = provider_matches

    if not candidates:
        return None

    # Score by weighted capability sum
    def score(p: ModelProfile) -> float:
        caps = p.capabilities
        # Weight reasoning and tool_use heavily for copilot/agent tasks
        weights = {
            "reasoning": 0.25,
            "tool_use": 0.20,
            "structured_output": 0.20,
            "cost_efficiency": 0.15,
            "speed": 0.10,
            "coding": 0.10,
        }
        return sum(caps.get(k, 0) * w for k, w in weights.items())

    candidates.sort(key=score, reverse=True)
    return candidates[0]


def get_profile(provider: str, model: str) -> ModelProfile | None:
    """Get a model profile by provider and model name."""
    for p in MODEL_PROFILES:
        if p.provider == provider and p.model == model:
            return p
    return None


def list_models(tier: TaskTier | None = None) -> list[ModelProfile]:
    """List all models, optionally filtered by tier."""
    if tier is None:
        return MODEL_PROFILES
    return [p for p in MODEL_PROFILES if p.tier == tier]
