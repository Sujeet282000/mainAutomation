"""
Semantic Ranker
===============

Instead of selecting the first catalog match, rank candidates by:
  1. Lexical overlap with the user's intent
  2. Has a live adapter (operational)
  3. Has connected accounts (ready to use)
  4. Operation type matches (trigger vs action)
  5. Auth complexity (simpler is better)

This produces a scored ranking that the model can then select from.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field


class RankedCandidate(BaseModel):
    """A catalog operation ranked by relevance."""
    slug: str
    name: str
    operation_key: str
    operation_name: str
    operation_type: str  # trigger | action | search
    auth_type: str = "none"
    score: float = 0.0
    reasons: list[str] = Field(default_factory=list)
    has_adapter: bool = False
    has_connection: bool = False


def rank_candidates(
    query: str,
    candidates: list[dict[str, Any]],
    *,
    kind: str | None = None,
    connected_apps: list[str] | None = None,
    live_adapters: set[str] | None = None,
    max_results: int = 8,
) -> list[RankedCandidate]:
    """
    Rank catalog candidates by relevance to the user's query.

    Args:
        query: The user's natural language request
        candidates: Raw catalog operation cards
        kind: Optional filter for "trigger" or "action"
        connected_apps: Apps with active connections
        live_adapters: Set of "slug:operation" keys that have live adapters
        max_results: Maximum candidates to return
    """
    connected = set(connected_apps or [])
    adapters = live_adapters or set()

    # Tokenize query
    query_tokens = set(_tokenize(query))

    ranked: list[RankedCandidate] = []

    for card in candidates:
        slug = card.get("slug", "")
        name = card.get("name", "")
        op_key = card.get("key", "")
        op_name = card.get("op_name") or card.get("key", "")
        op_type = card.get("type", "action")
        auth = card.get("authType", "none")

        # Filter by kind
        if kind == "trigger" and op_type != "trigger":
            continue
        if kind == "action" and op_type == "trigger":
            continue

        # Score components
        score = 0.0
        reasons = []

        # 1. Lexical overlap (0-40 points)
        name_tokens = set(_tokenize(f"{slug} {name} {op_name} {op_key}"))
        overlap = query_tokens & name_tokens
        overlap_ratio = len(overlap) / max(len(query_tokens), 1)
        score += overlap_ratio * 40
        if overlap:
            reasons.append(f"matched: {', '.join(list(overlap)[:3])}")

        # 2. Has live adapter (0-25 points)
        has_adapter = f"{slug}:{op_key}" in adapters or f"{slug}:*" in adapters
        if has_adapter:
            score += 25
            reasons.append("live_adapter")

        # 3. Has connected account (0-20 points)
        has_connection = slug in connected
        if has_connection:
            score += 20
            reasons.append("connected")

        # 4. Auth complexity penalty (-5 to 0)
        if auth in ("none",):
            score += 5
            reasons.append("no_auth")
        elif auth == "api_key":
            score += 2
        elif auth == "oauth2":
            score -= 2
            reasons.append("oauth_required")

        # 5. Exact name match bonus (+10)
        if slug.lower() in query.lower() or name.lower() in query.lower():
            score += 10
            reasons.append("exact_match")

        ranked.append(RankedCandidate(
            slug=slug,
            name=name,
            operation_key=op_key,
            operation_name=op_name,
            operation_type=op_type,
            auth_type=auth,
            score=round(score, 2),
            reasons=reasons,
            has_adapter=has_adapter,
            has_connection=has_connection,
        ))

    # Sort by score descending
    ranked.sort(key=lambda c: c.score, reverse=True)

    return ranked[:max_results]


def rank_triggers(
    query: str,
    candidates: list[dict[str, Any]],
    *,
    connected_apps: list[str] | None = None,
    live_adapters: set[str] | None = None,
) -> list[RankedCandidate]:
    """Rank trigger candidates specifically."""
    return rank_candidates(query, candidates, kind="trigger", connected_apps=connected_apps, live_adapters=live_adapters)


def rank_actions(
    query: str,
    candidates: list[dict[str, Any]],
    *,
    connected_apps: list[str] | None = None,
    live_adapters: set[str] | None = None,
) -> list[RankedCandidate]:
    """Rank action candidates specifically."""
    return rank_candidates(query, candidates, kind="action", connected_apps=connected_apps, live_adapters=live_adapters)


def select_best(
    ranked: list[RankedCandidate],
    *,
    require_adapter: bool = False,
    require_connection: bool = False,
    min_score: float = 5.0,
) -> RankedCandidate | None:
    """
    Select the best candidate from a ranked list.

    Applies additional constraints beyond pure score.
    """
    for candidate in ranked:
        if candidate.score < min_score:
            continue
        if require_adapter and not candidate.has_adapter:
            continue
        if require_connection and not candidate.has_connection:
            continue
        return candidate
    return ranked[0] if ranked else None


def _tokenize(text: str) -> list[str]:
    """Simple tokenizer for lexical matching."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s\-]", " ", text)
    tokens = text.split()
    # Filter short tokens and common words
    stop = {"the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from", "is", "are", "was", "were", "be", "been", "has", "have", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "that", "this", "these", "those", "it", "its", "my", "your", "our", "their", "when", "if", "then", "else", "so", "just", "also", "too", "very"}
    return [t for t in tokens if len(t) > 2 and t not in stop]
