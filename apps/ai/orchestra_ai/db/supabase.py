# ============================================================================
# Orchestra Part 7 — Supabase Reader (read-only views for AI service)
# ============================================================================

from __future__ import annotations

from typing import Any

import httpx


class SupabaseReader:
    """Read-only access to Supabase views via service key."""

    def __init__(self, client: httpx.AsyncClient, url: str, service_key: str) -> None:
        self._client = client
        self._url = url.rstrip("/")
        self._headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        }

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        """Execute a SQL query via Supabase RPC or direct query."""
        # For now, use the REST API with specific views
        raise NotImplementedError("Use fetch_view for view-based queries")

    async def fetch_view(
        self, view_name: str, params: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        """Fetch rows from a Supabase view."""
        response = await self._client.get(
            f"{self._url}/rest/v1/{view_name}",
            headers=self._headers,
            params=params or {"select": "*"},
        )
        response.raise_for_status()
        return response.json()

    async def rpc(
        self, function_name: str, payload: dict[str, Any]
    ) -> Any:
        """Call a Supabase RPC function."""
        response = await self._client.post(
            f"{self._url}/rest/v1/rpc/{function_name}",
            headers={**self._headers, "Content-Type": "application/json"},
            json=payload,
        )
        response.raise_for_status()
        return response.json()
