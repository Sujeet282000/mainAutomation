# ============================================================================
# Orchestra Part 7 — Catalog Repository
# Source of truth: Part 7 § "The Catalog Index"
# Hybrid retrieval with Reciprocal Rank Fusion
# ============================================================================

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


EMBEDDING_TEXT_VERSION = 1


@dataclass(frozen=True, slots=True)
class RetrievedOperation:
    operation_id: str
    canonical_id: str
    display_name: str
    description: str
    score: float


def content_hash(card: dict[str, Any]) -> str:
    """Content hash for idempotent reindex."""
    import hashlib
    raw = f"{card.get('operation_id', '')}:{card.get('display_name', '')}:{card.get('description', '')}"
    return hashlib.sha256(raw.encode()).hexdigest()


def operation_embedding_text(card: dict[str, Any]) -> str:
    """Normalized text for embedding and full-text search."""
    props = card.get("props", [])
    if isinstance(props, list):
        props_text = " ".join(
            f"{p.get('name', '')}: {p.get('aiHint', '')}"
            for p in props[:10]
        )
    else:
        props_text = ""

    return " ".join([
        f"{card.get('piece_display_name', '')} {card.get('kind', '')}: {card.get('display_name', '')}.",
        card.get("description", ""),
        f"Aliases: {', '.join(card.get('metadata', {}).get('aliases', []))}.",
        f"Inputs: {props_text}",
    ]).strip()


class CatalogRepository:
    def __init__(self, client: httpx.AsyncClient, url: str, service_key: str) -> None:
        self._client = client
        self._url = url.rstrip("/")
        self._headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        }

    async def cards_needing_reindex(self, model: str) -> list[dict[str, Any]]:
        """Find operations whose embeddings are stale."""
        response = await self._client.get(
            f"{self._url}/rest/v1/piece_operations",
            headers=self._headers,
            params={"select": "*"},
        )
        response.raise_for_status()
        cards = response.json()
        return [
            card for card in cards
            if card.get("indexed_content_hash") != content_hash(card)
            or card.get("indexed_embedding_model") != model
            or card.get("indexed_embedding_text_version") != EMBEDDING_TEXT_VERSION
        ]

    async def upsert_embedding(
        self,
        operation_id: str,
        card: dict[str, Any],
        vector: list[float],
    ) -> None:
        """Upsert an embedding for a catalog operation."""
        response = await self._client.post(
            f"{self._url}/rest/v1/rpc/upsert_piece_embedding",
            headers={**self._headers, "Content-Type": "application/json"},
            json={
                "p_operation_id": operation_id,
                "p_content_hash": content_hash(card),
                "p_embedding_model": "text-embedding-3-small",
                "p_embedding_text_version": EMBEDDING_TEXT_VERSION,
                "p_embedding": vector,
                "p_search_text": operation_embedding_text(card),
            },
        )
        response.raise_for_status()

    async def hybrid_search(
        self,
        query_text: str,
        embedding: list[float],
        limit: int = 12,
    ) -> list[RetrievedOperation]:
        """Hybrid vector + text search with Reciprocal Rank Fusion."""
        response = await self._client.post(
            f"{self._url}/rest/v1/rpc/match_operations_hybrid",
            headers={**self._headers, "Content-Type": "application/json"},
            json={
                "query_embedding": embedding,
                "query_text": query_text,
                "match_count": max(limit * 4, 40),
                "rrf_k": 60,
            },
        )
        response.raise_for_status()
        return [RetrievedOperation(**row) for row in response.json()[:limit]]
