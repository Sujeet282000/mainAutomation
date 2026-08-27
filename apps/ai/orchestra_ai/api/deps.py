# ============================================================================
# Orchestra — API Dependencies
# ============================================================================

from __future__ import annotations

import hashlib
import hmac as hmac_mod
import json
import time
from dataclasses import dataclass

from fastapi import Header, HTTPException, Request

from orchestra_ai.schemas.contracts import Attribution
from orchestra_ai.settings import get_settings


@dataclass
class Ctx:
    attribution: Attribution
    org_id: str
    request_id: str


async def require_service_token(
    request: Request,
    x_orchestra_service_token: str = Header(...),
) -> Ctx:
    """Verify the HMAC service token and extract attribution."""
    settings = get_settings()

    parts = x_orchestra_service_token.split(".")
    if len(parts) != 3 or parts[0] != "v1":
        raise HTTPException(status_code=401, detail="invalid_service_token")

    try:
        timestamp = int(parts[1])
    except ValueError:
        raise HTTPException(status_code=401, detail="invalid_service_token")

    age = abs(time.time() - timestamp)
    if age > settings.service_token_max_age_seconds:
        raise HTTPException(status_code=401, detail="service_token_expired")

    body = await request.body()
    body_sha256 = hashlib.sha256(body).hexdigest()

    try:
        body_json = json.loads(body) if body else {}
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="invalid_json")

    org_id = body_json.get("org_id", "")
    request_id = body_json.get("request_id", "")

    payload = f"v1:{timestamp}:{request.method}:{request.url.path}:{org_id}:{request_id}:{body_sha256}"
    expected = hmac_mod.new(
        settings.service_token.get_secret_value().encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac_mod.compare_digest(parts[2], expected):
        raise HTTPException(status_code=401, detail="invalid_service_token")

    return Ctx(
        attribution=Attribution(org_id=org_id, request_id=request_id),
        org_id=org_id,
        request_id=request_id,
    )
