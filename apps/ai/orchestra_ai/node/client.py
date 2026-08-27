# ============================================================================
# Orchestra Part 9 — Node API Client
# Python asks Node to execute tools because only Node holds credentials.
# ============================================================================

from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import uuid4

import httpx

from orchestra_ai.safety.auth import create_service_token


FALLBACK_OPS = [
    {"slug": "gmail", "name": "Gmail", "key": "new_email", "op_name": "New Email", "type": "trigger", "authType": "oauth2"},
    {"slug": "gmail", "name": "Gmail", "key": "send_email", "op_name": "Send Email", "type": "action", "authType": "oauth2"},
    {"slug": "slack", "name": "Slack", "key": "new_message", "op_name": "New Message", "type": "trigger", "authType": "oauth2"},
    {"slug": "slack", "name": "Slack", "key": "send_message", "op_name": "Send Message", "type": "action", "authType": "oauth2"},
    {"slug": "google-sheets", "name": "Google Sheets", "key": "new_row", "op_name": "New Row", "type": "trigger", "authType": "oauth2"},
    {"slug": "google-sheets", "name": "Google Sheets", "key": "create_row", "op_name": "Create Row", "type": "action", "authType": "oauth2"},
    {"slug": "webhook", "name": "Webhook", "key": "catch_hook", "op_name": "Catch Hook", "type": "trigger", "authType": "none"},
    {"slug": "http", "name": "HTTP", "key": "request", "op_name": "HTTP Request", "type": "action", "authType": "none"},
    {"slug": "schedule", "name": "Schedule", "key": "cron", "op_name": "Schedule", "type": "trigger", "authType": "none"},
]


class NodeApiClient:
    """Client for calling back to the Node API from Python."""

    def __init__(self, base_url: str, service_token: str) -> None:
        self._url = base_url.rstrip("/")
        self._token = service_token

    def _signed(self, method: str, path: str, payload: dict[str, Any]) -> tuple[dict[str, str], bytes]:
        body = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
        org_id = str(payload.get("org_id") or "")
        request_id = str(payload.get("request_id") or "")
        token = create_service_token(
            self._token,
            method.upper(),
            path,
            hashlib.sha256(body).hexdigest(),
            org_id,
            request_id,
        )
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            "X-Orchestra-Service-Token": token,
        }, body

    async def validate(
        self, definition: dict[str, Any], attribution: Any
    ) -> list[dict[str, Any]]:
        path = "/api/v1/internal/validate"
        payload = {
            "definition": definition,
            "org_id": getattr(attribution, "org_id", ""),
            "request_id": getattr(attribution, "request_id", str(uuid4())),
        }
        headers, body = self._signed("POST", path, payload)
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(f"{self._url}{path}", headers=headers, content=body)
            response.raise_for_status()
            return response.json().get("issues", [])

    async def search_catalog(self, query: str, kind: str | None = None) -> list[dict[str, Any]]:
        apps: list[dict[str, Any]] = []
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.get(f"{self._url}/api/v1/catalog", params={"q": query})
                response.raise_for_status()
                body = response.json()
                apps = body.get("apps") or body.get("catalog") or []
        except Exception:
            apps = []
        hits: list[dict[str, Any]] = []
        needle = query.lower()

        def consider(card: dict[str, Any]) -> None:
            if kind == "trigger" and card.get("type") != "trigger":
                return
            if kind == "action" and card.get("type") == "trigger":
                return
            hay = f"{card.get('slug','')} {card.get('name','')} {card.get('op_name') or card.get('key','')} {card.get('key','')}".lower()
            if any(tok in hay for tok in needle.split() if len(tok) > 2):
                hits.append(card)

        for app in apps:
            for op in app.get("operations") or []:
                consider(
                    {
                        "slug": app.get("slug"),
                        "name": app.get("name"),
                        "key": op.get("key"),
                        "op_name": op.get("name"),
                        "type": op.get("type"),
                        "authType": app.get("authType"),
                    }
                )
        if not hits:
            for card in FALLBACK_OPS:
                consider(card)
        return hits[:12]

    async def lookup_connections(self, org_id: str, piece: str, request_id: str) -> list[dict[str, Any]]:
        path = "/api/v1/internal/connections/lookup"
        payload = {"org_id": org_id, "request_id": request_id, "piece": piece}
        headers, body = self._signed("POST", path, payload)
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(f"{self._url}{path}", headers=headers, content=body)
            if response.status_code >= 400:
                return []
            return response.json().get("connections", [])

    async def execute_tool(
        self,
        operation_id: str,
        connection_id: str | None,
        arguments: dict[str, Any],
        run_id: str,
        step_id: str,
        nonce: str,
        timeout_s: int = 60,
        org_id: str = "",
        request_id: str = "",
    ) -> dict[str, Any]:
        path = "/api/v1/internal/execute-tool"
        payload = {
            "operation_id": operation_id,
            "connection_id": connection_id,
            "arguments": arguments,
            "run_id": run_id,
            "step_id": step_id,
            "nonce": nonce,
            "org_id": org_id,
            "request_id": request_id or str(uuid4()),
        }
        headers, body = self._signed("POST", path, payload)
        async with httpx.AsyncClient(timeout=timeout_s + 5) as client:
            response = await client.post(f"{self._url}{path}", headers=headers, content=body)
            return response.json()
