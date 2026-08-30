# ============================================================================
# Orchestra Part 7 — Provider Adapters (OpenAI + Anthropic)
# Source of truth: Part 7 § "Routing, contracts, and provider adapters"
# ============================================================================

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, AsyncIterator, Literal

import httpx

ProviderName = Literal["openai", "anthropic", "google", "local"]


@dataclass(frozen=True)
class ProviderReply:
    text: str
    tokens_in: int
    tokens_out: int
    cached_tokens: int = 0


class ProviderError(Exception):
    def __init__(self, status_code: int, body: str) -> None:
        self.status_code = status_code
        self.body = body
        super().__init__(f"Provider error {status_code}: {body[:200]}")


@dataclass(frozen=True)
class ByoKey:
    provider: str
    key: str


@dataclass(frozen=True)
class JsonSchema:
    name: str
    schema: dict[str, Any]


class ProviderAdapter:
    """Abstract base for model provider adapters."""

    async def complete(
        self,
        *,
        model: str,
        messages: list[Any],
        system: str | None,
        temperature: float,
        max_tokens: int,
        schema: JsonSchema | None = None,
        byo_key: ByoKey | None = None,
    ) -> ProviderReply:
        raise NotImplementedError

    async def stream(
        self,
        *,
        model: str,
        messages: list[Any],
        system: str | None,
        temperature: float,
        max_tokens: int,
        byo_key: ByoKey | None = None,
    ) -> AsyncIterator[str]:
        raise NotImplementedError

    async def embed(
        self,
        *,
        model: str,
        texts: list[str],
        byo_key: ByoKey | None = None,
    ) -> list[list[float]]:
        raise NotImplementedError


class GeminiAdapter(ProviderAdapter):
    """Google Gemini adapter using the OpenAI-compatible API endpoint."""

    def __init__(self, client: httpx.AsyncClient, api_key: str, base_url: str) -> None:
        self._client = client
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    def _headers(self, byo_key: ByoKey | None) -> dict[str, str]:
        key = byo_key.key if byo_key and byo_key.provider == "google" else self._api_key
        return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    async def complete(self, **kwargs: Any) -> ProviderReply:
        messages = list(kwargs["messages"])
        system = kwargs.get("system")
        schema = kwargs.get("schema")

        request_messages: list[dict[str, str]] = []
        if isinstance(system, str):
            request_messages.append({"role": "user", "content": system})
        request_messages.extend(
            {"role": item.role, "content": item.content}
            for item in messages
            if hasattr(item, "role")
        )

        body: dict[str, Any] = {
            "model": kwargs["model"],
            "contents": request_messages,
            "generationConfig": {
                "temperature": kwargs["temperature"],
                "maxOutputTokens": kwargs["max_tokens"],
            },
        }

        if isinstance(schema, JsonSchema):
            body["generationConfig"]["responseMimeType"] = "application/json"
            body["generationConfig"]["responseSchema"] = schema.schema

        byo = kwargs.get("byo_key")
        response = await self._client.post(
            f"{self._base_url}/v1beta/models/{kwargs['model']}:generateContent",
            headers=self._headers(byo if isinstance(byo, ByoKey) else None),
            json=body,
        )
        if response.status_code >= 400:
            raise ProviderError(response.status_code, response.text[:500])

        data = response.json()
        candidates = data.get("candidates", [])
        text = ""
        if candidates and candidates[0].get("content", {}).get("parts"):
            text = "".join(p.get("text", "") for p in candidates[0]["content"]["parts"])
        usage_meta = data.get("usageMetadata", {})
        return ProviderReply(
            text,
            usage_meta.get("promptTokenCount", 0),
            usage_meta.get("candidatesTokenCount", 0),
        )

    async def stream(self, **kwargs: Any) -> AsyncIterator[str]:
        messages = list(kwargs["messages"])
        system = kwargs.get("system")

        request_messages: list[dict[str, str]] = []
        if isinstance(system, str):
            request_messages.append({"role": "user", "content": system})
        request_messages.extend(
            {"role": item.role, "content": item.content}
            for item in messages
            if hasattr(item, "role")
        )

        body: dict[str, Any] = {
            "model": kwargs["model"],
            "contents": request_messages,
            "generationConfig": {
                "temperature": kwargs["temperature"],
                "maxOutputTokens": kwargs["max_tokens"],
            },
        }

        byo = kwargs.get("byo_key")
        async with self._client.stream(
            "POST",
            f"{self._base_url}/v1beta/models/{kwargs['model']}:streamGenerateContent?alt=sse",
            headers=self._headers(byo if isinstance(byo, ByoKey) else None),
            json=body,
        ) as response:
            if response.status_code >= 400:
                err_body = (await response.aread()).decode()[:500]
                raise ProviderError(response.status_code, err_body)
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    event = json.loads(line[6:])
                    candidates = event.get("candidates", [])
                    if candidates and candidates[0].get("content", {}).get("parts"):
                        for part in candidates[0]["content"]["parts"]:
                            if part.get("text"):
                                yield part["text"]
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue

    async def embed(self, **kwargs: Any) -> list[list[float]]:
        byo = kwargs.get("byo_key")
        key = (byo.key if byo and byo.provider == "google" else self._api_key)
        response = await self._client.post(
            f"{self._base_url}/v1beta/models/{kwargs['model']}:embedContent",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": kwargs["model"], "content": {"parts": [{"text": t} for t in kwargs["texts"]]}},
        )
        if response.status_code >= 400:
            raise ProviderError(response.status_code, response.text[:500])
        data = response.json()
        return [data.get("embedding", {}).get("values", [0.0] * 8)]


class LocalOpenAICompatibleAdapter(ProviderAdapter):
    """Adapter for any OpenAI-compatible local endpoint (Ollama, vLLM, LM Studio, LocalAI)."""

    MODEL_ALIASES: dict[str, str] = {}

    def __init__(self, client: httpx.AsyncClient, api_key: str, base_url: str) -> None:
        self._client = client
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    def _model(self, model: str) -> str:
        return self.MODEL_ALIASES.get(model, model)

    def _headers(self, byo_key: ByoKey | None) -> dict[str, str]:
        key = byo_key.key if byo_key and byo_key.provider == "local" else self._api_key
        return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    async def complete(self, **kwargs: Any) -> ProviderReply:
        model = self._model(str(kwargs["model"]))
        messages = list(kwargs["messages"])
        system = kwargs.get("system")
        schema = kwargs.get("schema")

        request_messages: list[dict[str, str]] = []
        if isinstance(system, str):
            request_messages.append({"role": "system", "content": system})
        request_messages.extend(
            {"role": item.role, "content": item.content}
            for item in messages
            if hasattr(item, "role")
        )

        body: dict[str, Any] = {
            "model": model,
            "messages": request_messages,
            "temperature": kwargs["temperature"],
            "max_tokens": kwargs["max_tokens"],
        }

        if isinstance(schema, JsonSchema):
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": schema.name, "strict": False, "schema": schema.schema},
            }

        byo = kwargs.get("byo_key")
        response = await self._client.post(
            f"{self._base_url}/chat/completions",
            headers=self._headers(byo if isinstance(byo, ByoKey) else None),
            json=body,
        )
        if response.status_code >= 400 and isinstance(schema, JsonSchema):
            body["response_format"] = {"type": "json_object"}
            response = await self._client.post(
                f"{self._base_url}/chat/completions",
                headers=self._headers(byo if isinstance(byo, ByoKey) else None),
                json=body,
            )
        if response.status_code >= 400:
            raise ProviderError(response.status_code, response.text[:500])

        data = response.json()
        usage = data.get("usage") or {}
        text = data["choices"][0]["message"].get("content") or ""
        return ProviderReply(
            text,
            usage.get("prompt_tokens", 0),
            usage.get("completion_tokens", 0),
            usage.get("prompt_tokens_details", {}).get("cached_tokens", 0),
        )

    async def stream(self, **kwargs: Any) -> AsyncIterator[str]:
        model = self._model(str(kwargs["model"]))
        messages = list(kwargs["messages"])
        system = kwargs.get("system")

        body_messages = [] if system is None else [{"role": "system", "content": system}]
        body_messages.extend(
            {"role": item.role, "content": item.content}
            for item in messages
            if hasattr(item, "role")
        )

        body = {
            "model": model,
            "messages": body_messages,
            "temperature": kwargs["temperature"],
            "max_tokens": kwargs["max_tokens"],
            "stream": True,
        }

        byo = kwargs.get("byo_key")
        async with self._client.stream(
            "POST",
            f"{self._base_url}/chat/completions",
            headers=self._headers(byo if isinstance(byo, ByoKey) else None),
            json=body,
        ) as response:
            if response.status_code >= 400:
                err_body = (await response.aread()).decode()[:500]
                raise ProviderError(response.status_code, err_body)
            async for line in response.aiter_lines():
                if not line.startswith("data: ") or line == "data: [DONE]":
                    continue
                try:
                    delta = json.loads(line[6:])["choices"][0]["delta"].get("content")
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
                if delta:
                    yield delta

    async def embed(self, **kwargs: Any) -> list[list[float]]:
        byo = kwargs.get("byo_key")
        response = await self._client.post(
            f"{self._base_url}/embeddings",
            headers=self._headers(byo if isinstance(byo, ByoKey) else None),
            json={"model": kwargs["model"], "input": kwargs["texts"]},
        )
        if response.status_code >= 400:
            raise ProviderError(response.status_code, response.text[:500])
        return [row["embedding"] for row in response.json()["data"]]


class OpenAIAdapter(ProviderAdapter):
    MODEL_ALIASES = {
        "gpt-4.1": "gpt-4o",
        "gpt-4.1-mini": "gpt-4o-mini",
    }

    def __init__(self, client: httpx.AsyncClient, api_key: str, base_url: str) -> None:
        self._client = client
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    def _model(self, model: str) -> str:
        return self.MODEL_ALIASES.get(model, model)

    def _headers(self, byo_key: ByoKey | None) -> dict[str, str]:
        key = byo_key.key if byo_key and byo_key.provider == "openai" else self._api_key
        return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    async def complete(self, **kwargs: Any) -> ProviderReply:
        model = self._model(str(kwargs["model"]))
        messages = list(kwargs["messages"])
        system = kwargs.get("system")
        schema = kwargs.get("schema")

        request_messages: list[dict[str, str]] = []
        if isinstance(system, str):
            request_messages.append({"role": "system", "content": system})
        request_messages.extend(
            {"role": item.role, "content": item.content}
            for item in messages
            if hasattr(item, "role")
        )

        body: dict[str, Any] = {
            "model": model,
            "messages": request_messages,
            "temperature": kwargs["temperature"],
            "max_tokens": kwargs["max_tokens"],
        }

        if isinstance(schema, JsonSchema):
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": schema.name,
                    "strict": False,
                    "schema": schema.schema,
                },
            }

        byo = kwargs.get("byo_key")
        response = await self._client.post(
            f"{self._base_url}/chat/completions",
            headers=self._headers(byo if isinstance(byo, ByoKey) else None),
            json=body,
        )
        if response.status_code >= 400 and isinstance(schema, JsonSchema):
            body["response_format"] = {"type": "json_object"}
            response = await self._client.post(
                f"{self._base_url}/chat/completions",
                headers=self._headers(byo if isinstance(byo, ByoKey) else None),
                json=body,
            )
        if response.status_code >= 400:
            raise ProviderError(response.status_code, response.text[:500])

        data = response.json()
        usage = data.get("usage") or {}
        text = data["choices"][0]["message"].get("content") or ""
        return ProviderReply(
            text,
            usage.get("prompt_tokens", 0),
            usage.get("completion_tokens", 0),
            usage.get("prompt_tokens_details", {}).get("cached_tokens", 0),
        )

    async def stream(self, **kwargs: Any) -> AsyncIterator[str]:
        model = self._model(str(kwargs["model"]))
        messages = list(kwargs["messages"])
        system = kwargs.get("system")

        body_messages = [] if system is None else [{"role": "system", "content": system}]
        body_messages.extend(
            {"role": item.role, "content": item.content}
            for item in messages
            if hasattr(item, "role")
        )

        body = {
            "model": model,
            "messages": body_messages,
            "temperature": kwargs["temperature"],
            "max_tokens": kwargs["max_tokens"],
            "stream": True,
        }

        byo = kwargs.get("byo_key")
        async with self._client.stream(
            "POST",
            f"{self._base_url}/chat/completions",
            headers=self._headers(byo if isinstance(byo, ByoKey) else None),
            json=body,
        ) as response:
            if response.status_code >= 400:
                err_body = (await response.aread()).decode()[:500]
                raise ProviderError(response.status_code, err_body)
            async for line in response.aiter_lines():
                if not line.startswith("data: ") or line == "data: [DONE]":
                    continue
                try:
                    delta = json.loads(line[6:])["choices"][0]["delta"].get("content")
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
                if delta:
                    yield delta

    async def embed(self, **kwargs: Any) -> list[list[float]]:
        byo = kwargs.get("byo_key")
        response = await self._client.post(
            f"{self._base_url}/embeddings",
            headers=self._headers(byo if isinstance(byo, ByoKey) else None),
            json={"model": kwargs["model"], "input": kwargs["texts"]},
        )
        if response.status_code >= 400:
            raise ProviderError(response.status_code, response.text[:500])
        return [row["embedding"] for row in response.json()["data"]]


class AnthropicAdapter(ProviderAdapter):
    def __init__(self, client: httpx.AsyncClient, api_key: str, base_url: str) -> None:
        self._client = client
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    def _headers(self, byo_key: ByoKey | None) -> dict[str, str]:
        key = byo_key.key if byo_key and byo_key.provider == "anthropic" else self._api_key
        return {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    async def complete(self, **kwargs: Any) -> ProviderReply:
        schema = kwargs.get("schema")
        system = kwargs.get("system") or ""

        if isinstance(schema, JsonSchema):
            schema_text = json.dumps(schema.schema)
            system = f"{system}\nReturn only JSON matching this schema:\n{schema_text}"

        body: dict[str, Any] = {
            "model": kwargs["model"],
            "system": system,
            "messages": [
                {"role": item.role, "content": item.content}
                for item in kwargs["messages"]
                if hasattr(item, "role")
            ],
            "temperature": kwargs["temperature"],
            "max_tokens": kwargs["max_tokens"],
        }

        byo = kwargs.get("byo_key")
        response = await self._client.post(
            f"{self._base_url}/v1/messages",
            headers=self._headers(byo if isinstance(byo, ByoKey) else None),
            json=body,
        )
        if response.status_code >= 400:
            raise ProviderError(response.status_code, response.text[:500])

        data = response.json()
        usage = data.get("usage") or {}
        text = "".join(part.get("text", "") for part in data.get("content", []))
        return ProviderReply(
            text,
            usage.get("input_tokens", 0),
            usage.get("output_tokens", 0),
        )

    async def stream(self, **kwargs: Any) -> AsyncIterator[str]:
        body: dict[str, Any] = {
            "model": kwargs["model"],
            "system": kwargs.get("system") or "",
            "messages": [
                {"role": item.role, "content": item.content}
                for item in kwargs["messages"]
                if hasattr(item, "role")
            ],
            "temperature": kwargs["temperature"],
            "max_tokens": kwargs["max_tokens"],
            "stream": True,
        }

        byo = kwargs.get("byo_key")
        async with self._client.stream(
            "POST",
            f"{self._base_url}/v1/messages",
            headers=self._headers(byo if isinstance(byo, ByoKey) else None),
            json=body,
        ) as response:
            if response.status_code >= 400:
                err_body = (await response.aread()).decode()[:500]
                raise ProviderError(response.status_code, err_body)
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    event = json.loads(line[6:])
                    if event.get("type") == "content_block_delta":
                        yield event.get("delta", {}).get("text", "")
                except (json.JSONDecodeError, KeyError):
                    continue
