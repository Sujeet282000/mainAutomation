# ============================================================================
# Orchestra Part 7 — Model Gateway
# Source of truth: Part 7 § "The Model Gateway"
# The single egress point to model providers. Routing, pricing, token counting,
# retries, budget controls, cache policy, usage accounting — all uniform.
# ============================================================================

from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass, field, replace
from decimal import Decimal
from typing import Any, AsyncIterator

import httpx
import tiktoken
from pydantic import BaseModel, ValidationError
from tenacity import (
    AsyncRetrying,
    retry_if_exception,
    stop_after_attempt,
    wait_random_exponential,
)

from orchestra_ai.gateway.providers import (
    ByoKey,
    JsonSchema,
    ProviderAdapter,
    ProviderError,
    ProviderName,
    ProviderReply,
)
from orchestra_ai.schemas.contracts import Attribution, Usage


# ── Model purposes ──────────────────────────────────────────────────────────

class Purpose:
    COPILOT_PLAN = "copilot_plan"
    COPILOT_SELECT = "copilot_select"
    COPILOT_MAP = "copilot_map"
    COPILOT_REPAIR = "copilot_repair"
    COPILOT_REFINE = "copilot_refine"
    AI_STEP_GENERATE = "ai_step_generate"
    AI_STEP_CLASSIFY = "ai_step_classify"
    AI_STEP_EXTRACT = "ai_step_extract"
    AGENT_LOOP = "agent_loop"
    OPS_DIAGNOSE = "ops_diagnose"
    EMBED = "embed"


@dataclass(frozen=True, slots=True)
class ModelRoute:
    provider: ProviderName
    model: str
    temperature: float
    max_tokens: int
    fallback_provider: ProviderName | None = None
    fallback_model: str | None = None


ROUTES: dict[str, ModelRoute] = {
    Purpose.COPILOT_PLAN: ModelRoute("anthropic", "claude-sonnet-4-5", 0.1, 4096, "openai", "gpt-4.1"),
    Purpose.COPILOT_SELECT: ModelRoute("openai", "gpt-4.1-mini", 0.0, 1600, "anthropic", "claude-sonnet-4-5"),
    Purpose.COPILOT_MAP: ModelRoute("openai", "gpt-4.1", 0.0, 4096, "anthropic", "claude-sonnet-4-5"),
    Purpose.COPILOT_REPAIR: ModelRoute("anthropic", "claude-sonnet-4-5", 0.0, 3000, "openai", "gpt-4.1"),
    Purpose.COPILOT_REFINE: ModelRoute("anthropic", "claude-sonnet-4-5", 0.2, 4096, "openai", "gpt-4.1"),
    Purpose.AI_STEP_GENERATE: ModelRoute("openai", "gpt-4.1-mini", 0.2, 1024, "anthropic", "claude-sonnet-4-5"),
    Purpose.AI_STEP_CLASSIFY: ModelRoute("openai", "gpt-4.1-mini", 0.0, 500, "anthropic", "claude-sonnet-4-5"),
    Purpose.AI_STEP_EXTRACT: ModelRoute("openai", "gpt-4.1-mini", 0.0, 1500, "anthropic", "claude-sonnet-4-5"),
    Purpose.AGENT_LOOP: ModelRoute("anthropic", "claude-sonnet-4-5", 0.2, 3000, "openai", "gpt-4.1"),
    Purpose.OPS_DIAGNOSE: ModelRoute("openai", "gpt-4.1", 0.0, 2000, "anthropic", "claude-sonnet-4-5"),
    Purpose.EMBED: ModelRoute("openai", "text-embedding-3-small", 0.0, 0),
}

PRICE_PER_MILLION: dict[str, tuple[Decimal, Decimal]] = {
    "gpt-4.1": (Decimal("2.00"), Decimal("8.00")),
    "gpt-4.1-mini": (Decimal("0.40"), Decimal("1.60")),
    "claude-sonnet-4-5": (Decimal("3.00"), Decimal("15.00")),
    "text-embedding-3-small": (Decimal("0.02"), Decimal("0.00")),
}


# ── Message model ───────────────────────────────────────────────────────────

class Message(BaseModel):
    model_config = {"extra": "forbid"}
    role: str  # "user" | "assistant" | "tool"
    content: str
    tool_call_id: str | None = None


# ── Call spec ────────────────────────────────────────────────────────────────

@dataclass
class CallSpec:
    purpose: str
    system: str | None
    messages: list[Message]
    json_schema: JsonSchema | None = None
    schema_name: str = ""
    temperature: float | None = None
    max_tokens: int | None = None
    attribution: Attribution | None = None
    cacheable: bool = False
    byo_key: ByoKey | None = None
    max_cost_usd: float | None = None
    timeout_s: float | None = None
    model: str | None = None


# ── Gateway result ──────────────────────────────────────────────────────────

@dataclass
class GatewayResult:
    text: str
    usage: Usage
    raw: dict[str, Any] = field(default_factory=dict)


# ── Errors ──────────────────────────────────────────────────────────────────

class AiBudgetExceeded(Exception):
    pass


class AiSchemaInvalid(Exception):
    pass


# ── Budget enforcer (Redis Lua script) ──────────────────────────────────────

RESERVE_LUA = """
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
if current + limit > limit then return 0 end
redis.call('INCRBYFLOAT', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
"""


class BudgetEnforcer:
    def __init__(self, redis: Any, daily_limit: Decimal, request_limit: Decimal) -> None:
        self._redis = redis
        self._daily_limit = daily_limit
        self._request_limit = request_limit

    async def reserve(self, org_id: str, request_id: str, amount: Decimal) -> str:
        if amount > self._request_limit:
            raise AiBudgetExceeded("AI_BUDGET_EXCEEDED: request maximum")
        key = f"ai:budget:{org_id}:{time.strftime('%Y-%m-%d', time.gmtime())}"
        try:
            accepted = await self._redis.eval(
                RESERVE_LUA, 1, key, str(float(amount)), str(float(self._daily_limit)), "172800",
            )
            if not accepted:
                raise AiBudgetExceeded("AI_BUDGET_EXCEEDED: organization daily budget")
        except AiBudgetExceeded:
            raise
        except Exception:
            # In dev mode, skip budget enforcement on Redis errors
            pass
        return key

    async def reconcile(self, key: str, reserved: Decimal, actual: Decimal) -> None:
        difference = reserved - actual
        if difference > 0:
            await self._redis.incrbyfloat(key, -float(difference))


# ── Prompt cache ────────────────────────────────────────────────────────────

class PromptCache:
    def __init__(self, redis: Any, ttl_seconds: int) -> None:
        self._redis = redis
        self._ttl = ttl_seconds

    def key(self, payload: dict[str, Any]) -> str:
        raw = json.dumps(payload, sort_keys=True, default=str)
        return f"ai:cache:{hashlib.sha256(raw.encode()).hexdigest()}"

    async def get(self, key: str) -> dict[str, Any] | None:
        raw = await self._redis.get(key)
        return json.loads(raw) if raw else None

    async def set(self, key: str, value: dict[str, Any]) -> None:
        await self._redis.set(key, json.dumps(value, default=str), ex=self._ttl)


# ── Usage repository ────────────────────────────────────────────────────────

class UsageRepository:
    def __init__(self, client: httpx.AsyncClient, url: str, service_key: str) -> None:
        self._client = client
        self._url = url.rstrip("/")
        self._headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    async def emit(self, attribution: Attribution, usage: Usage) -> None:
        try:
            await self._client.post(
                f"{self._url}/rest/v1/rpc/record_ai_usage",
                headers={**self._headers, "Content-Type": "application/json"},
                json={
                    "p_org_id": attribution.org_id,
                    "p_request_id": attribution.request_id,
                    "p_provider": usage.provider,
                    "p_model": usage.model,
                    "p_purpose": usage.purpose,
                    "p_tokens_in": usage.tokensIn,
                    "p_tokens_out": usage.tokensOut,
                    "p_cost_usd": float(usage.costUsd),
                    "p_latency_ms": usage.latencyMs,
                    "p_byo_key": usage.byoKey,
                },
            )
        except Exception:
            # Gracefully handle Supabase unavailability in dev mode
            pass


# ── Model Gateway ───────────────────────────────────────────────────────────

class ModelGateway:
    def __init__(
        self,
        *,
        providers: dict[ProviderName, ProviderAdapter],
        cache: PromptCache,
        budgets: BudgetEnforcer,
        usage: UsageRepository,
        routes: dict[str, ModelRoute],
        max_embedding_batch_size: int,
    ) -> None:
        self._providers = providers
        self._cache = cache
        self._budgets = budgets
        self._usage = usage
        self._routes = routes
        self._batch_size = max_embedding_batch_size

    def _route(self, spec: CallSpec) -> ModelRoute:
        configured = self._routes[spec.purpose]
        if spec.model is None or spec.model == "auto":
            return configured
        if spec.model != configured.model:
            raise ValueError("MODEL_OVERRIDE_NOT_PERMITTED")
        return configured

    @staticmethod
    def _price(model: str, tokens_in: int, tokens_out: int, byo_key: bool) -> Decimal:
        if byo_key:
            return Decimal("0")
        input_price, output_price = PRICE_PER_MILLION.get(
            model, (Decimal(0), Decimal(0))
        )
        return (Decimal(tokens_in) * input_price + Decimal(tokens_out) * output_price) / 1_000_000

    @staticmethod
    def _retryable(error: BaseException) -> bool:
        return isinstance(error, ProviderError) and error.status_code in {429, 500, 502, 503, 529}

    @staticmethod
    def _token_count(model: str, text: str) -> int:
        try:
            encoding = tiktoken.encoding_for_model(model)
        except KeyError:
            encoding = tiktoken.get_encoding("o200k_base")
        return len(encoding.encode(text))

    def _cache_key(self, spec: CallSpec, route: ModelRoute) -> str | None:
        if not spec.cacheable or spec.byo_key is not None:
            return None
        payload = {
            "purpose": spec.purpose,
            "model": route.model,
            "system": spec.system,
            "messages": [{"role": m.role, "content": m.content} for m in spec.messages],
            "schema": spec.json_schema.model_dump() if spec.json_schema else None,
        }
        return self._cache.key(payload)

    @staticmethod
    def _reservation_cost(route: ModelRoute, spec: CallSpec) -> Decimal:
        input_text = (spec.system or "") + "\n" + "\n".join(m.content for m in spec.messages)
        estimated_in = ModelGateway._token_count(route.model, input_text)
        max_out = spec.max_tokens or route.max_tokens
        return ModelGateway._price(route.model, estimated_in, max_out, spec.byo_key is not None)

    async def _with_retry(
        self, adapter: ProviderAdapter, spec: CallSpec, route: ModelRoute
    ) -> ProviderReply:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_random_exponential(multiplier=0.5, max=8),
            retry=retry_if_exception(self._retryable),
            reraise=True,
        ):
            with attempt:
                return await adapter.complete(
                    model=route.model,
                    messages=spec.messages,
                    system=spec.system,
                    temperature=(
                        spec.temperature if spec.temperature is not None else route.temperature
                    ),
                    max_tokens=(
                        spec.max_tokens if spec.max_tokens is not None else route.max_tokens
                    ),
                    schema=spec.json_schema,
                    byo_key=spec.byo_key,
                )
        raise RuntimeError("unreachable")

    async def _complete(self, spec: CallSpec, route: ModelRoute) -> tuple[ProviderReply, ModelRoute]:
        adapter = self._providers[route.provider]
        try:
            reply = await self._with_retry(adapter, spec, route)
            return reply, route
        except ProviderError as first_error:
            if route.fallback_provider is None or route.fallback_model is None:
                raise first_error
            fallback = replace(
                route,
                provider=route.fallback_provider,
                model=route.fallback_model,
                fallback_provider=None,
                fallback_model=None,
            )
            reply = await self._with_retry(
                self._providers[fallback.provider], spec, fallback
            )
            return reply, fallback

    async def call(self, spec: CallSpec) -> GatewayResult:
        route = self._route(spec)
        cache_key = self._cache_key(spec, route)

        if cache_key:
            cached = await self._cache.get(cache_key)
            if cached:
                return GatewayResult(
                    text=str(cached["text"]),
                    usage=Usage(**cached["usage"]),
                    raw=dict(cached.get("raw", {})),
                )

        reserved = self._reservation_cost(route, spec)
        attribution = spec.attribution or Attribution(org_id="unknown", request_id="unknown")
        budget_key = await self._budgets.reserve(
            attribution.org_id, attribution.request_id, reserved
        )

        started = time.perf_counter()
        try:
            reply, used_route = await self._complete(spec, route)
            latency_ms = int((time.perf_counter() - started) * 1000)
            cost = self._price(
                used_route.model, reply.tokens_in, reply.tokens_out,
                spec.byo_key is not None,
            )
            usage = Usage(
                provider=used_route.provider,
                model=used_route.model,
                purpose=spec.purpose,
                tokensIn=reply.tokens_in,
                tokensOut=reply.tokens_out,
                cachedTokens=reply.cached_tokens,
                costUsd=float(cost),
                latencyMs=latency_ms,
                byoKey=spec.byo_key is not None,
            )
            await self._usage.emit(attribution, usage)
            await self._budgets.reconcile(budget_key, reserved, cost)

            result = GatewayResult(
                text=reply.text,
                usage=usage,
                raw={"provider": used_route.provider},
            )

            if cache_key:
                await self._cache.set(cache_key, {
                    "text": result.text,
                    "usage": usage.model_dump(),
                    "raw": result.raw,
                })

            return result
        except Exception:
            await self._budgets.reconcile(budget_key, reserved, Decimal("0"))
            raise

    async def call_json(
        self, spec: CallSpec, output_model: type[BaseModel]
    ) -> tuple[BaseModel, Usage]:
        """Call with structured output and automatic repair pass."""
        if spec.json_schema is None:
            # Auto-derive JSON schema from output model
            schema = JsonSchema(name=output_model.__name__, schema=output_model.model_json_schema())
            spec = CallSpec(
                purpose=spec.purpose,
                system=spec.system,
                messages=spec.messages,
                json_schema=schema,
                schema_name=output_model.__name__,
                attribution=spec.attribution,
                cacheable=spec.cacheable,
                byo_key=spec.byo_key,
                temperature=spec.temperature,
                max_tokens=spec.max_tokens,
                max_cost_usd=spec.max_cost_usd,
                timeout_s=spec.timeout_s,
            )

        first = await self.call(spec)
        try:
            return output_model.model_validate_json(first.text), first.usage
        except (ValidationError, ValueError) as first_error:
            # Single repair pass
            repair = CallSpec(
                purpose=spec.purpose,
                system=spec.system,
                json_schema=spec.json_schema,
                schema_name=spec.schema_name,
                attribution=spec.attribution,
                cacheable=False,
                byo_key=spec.byo_key,
                temperature=0,
                messages=[
                    *spec.messages,
                    Message(role="assistant", content=first.text),
                    Message(
                        role="user",
                        content=(
                            "Correct the prior output. Return only JSON matching the schema. "
                            f"Validation error: {str(first_error)[:800]}"
                        ),
                    ),
                ],
            )
            second = await self.call(repair)
            try:
                return output_model.model_validate_json(second.text), second.usage
            except (ValidationError, ValueError):
                raise AiSchemaInvalid("AI_SCHEMA_INVALID")

    async def stream(self, spec: CallSpec) -> AsyncIterator[str]:
        if spec.json_schema is not None or spec.cacheable:
            raise ValueError("streaming cannot use structured output or response cache")

        route = self._route(spec)
        adapter = self._providers[route.provider]
        attribution = spec.attribution or Attribution(org_id="unknown", request_id="unknown")

        reserved = self._reservation_cost(route, spec)
        budget_key = await self._budgets.reserve(
            attribution.org_id, attribution.request_id, reserved
        )

        started = time.perf_counter()
        chunks: list[str] = []
        selected_route = route
        yielded = False

        try:
            async for token in adapter.stream(
                model=route.model,
                messages=spec.messages,
                system=spec.system,
                temperature=(
                    spec.temperature if spec.temperature is not None else route.temperature
                ),
                max_tokens=(
                    spec.max_tokens if spec.max_tokens is not None else route.max_tokens
                ),
                byo_key=spec.byo_key,
            ):
                yielded = True
                chunks.append(token)
                yield token
        except ProviderError:
            if yielded or route.fallback_provider is None or route.fallback_model is None:
                raise
            fallback = self._providers[route.fallback_provider]
            selected_route = replace(
                route, provider=route.fallback_provider, model=route.fallback_model,
            )
            async for token in fallback.stream(
                model=selected_route.model,
                messages=spec.messages,
                system=spec.system,
                temperature=(
                    spec.temperature
                    if spec.temperature is not None
                    else selected_route.temperature
                ),
                max_tokens=(
                    spec.max_tokens
                    if spec.max_tokens is not None
                    else selected_route.max_tokens
                ),
                byo_key=spec.byo_key,
            ):
                chunks.append(token)
                yield token
        except Exception:
            await self._budgets.reconcile(budget_key, reserved, Decimal("0"))
            raise
        else:
            output = "".join(chunks)
            input_text = (spec.system or "") + "\n"
            input_text += "\n".join(m.content for m in spec.messages)
            tokens_in = self._token_count(selected_route.model, input_text)
            tokens_out = self._token_count(selected_route.model, output)
            cost = self._price(
                selected_route.model, tokens_in, tokens_out,
                spec.byo_key is not None,
            )
            usage = Usage(
                provider=selected_route.provider,
                model=selected_route.model,
                purpose=spec.purpose,
                tokensIn=tokens_in,
                tokensOut=tokens_out,
                costUsd=float(cost),
                latencyMs=int((time.perf_counter() - started) * 1000),
                byoKey=spec.byo_key is not None,
            )
            await self._usage.emit(attribution, usage)
            await self._budgets.reconcile(budget_key, reserved, cost)


# Singleton gateway instance (lazy init)
_gateway: "ModelGateway | None" = None


async def initialise_gateway():
    """Initialise the global gateway singleton."""
    get_gateway()


async def close_gateway():
    """Shut down the global gateway singleton."""
    global _gateway
    _gateway = None


def provider_status() -> dict[str, Any]:
    from orchestra_ai.settings import get_settings, live_secret

    settings = get_settings()
    openai = live_secret(settings.openai_api_key) is not None
    anthropic = live_secret(settings.anthropic_api_key) is not None
    return {
        "openai": openai,
        "anthropic": anthropic,
        "mode": "live" if (openai or anthropic) else "heuristic",
    }


def _adapt_routes(providers: dict[str, ProviderAdapter]) -> dict[str, ModelRoute]:
    adapted: dict[str, ModelRoute] = {}
    names = set(providers.keys())
    for purpose, route in ROUTES.items():
        if route.provider in names:
            adapted[purpose] = route
            continue
        if route.fallback_provider in names:
            adapted[purpose] = replace(
                route,
                provider=route.fallback_provider,  # type: ignore[arg-type]
                model=route.fallback_model or route.model,
                fallback_provider=None,
                fallback_model=None,
            )
            continue
        first = next(iter(names))
        model = "gpt-4o-mini" if first == "openai" else ("claude-sonnet-4-5" if first == "anthropic" else "dev-mock")
        adapted[purpose] = ModelRoute(first, model, route.temperature, route.max_tokens)  # type: ignore[arg-type]
    return adapted


def get_gateway() -> "ModelGateway":
    """Get or create the singleton ModelGateway instance."""
    global _gateway
    if _gateway is None:
        import redis.asyncio as aioredis
        import httpx
        from decimal import Decimal
        from orchestra_ai.gateway.providers import OpenAIAdapter, AnthropicAdapter, ProviderReply
        from orchestra_ai.settings import get_settings, live_secret

        _settings = get_settings()
        _redis = aioredis.from_url(_settings.redis_url, decode_responses=True)
        _http = httpx.AsyncClient(timeout=_settings.model_timeout_seconds)

        providers: dict[str, ProviderAdapter] = {}
        openai_key = live_secret(_settings.openai_api_key)
        anthropic_key = live_secret(_settings.anthropic_api_key)
        if openai_key:
            providers["openai"] = OpenAIAdapter(_http, openai_key, _settings.openai_base_url)
        if anthropic_key:
            providers["anthropic"] = AnthropicAdapter(_http, anthropic_key, _settings.anthropic_base_url)

        if not providers:
            class DevProvider(ProviderAdapter):
                """Returns mock structured responses for development without API keys."""
                async def complete(self, **kwargs):
                    msgs = kwargs.get("messages", [])
                    user_msg = ""
                    for m in msgs:
                        if hasattr(m, "content"):
                            user_msg = m.content
                    mock = {
                        "summary": f"Automate: {user_msg[:100]}",
                        "trigger": {"kind": "app_event", "app_hint": "gmail", "event_hint": "new_email", "search_text": user_msg[:80], "schedule_hint": None},
                        "actions": [{"purpose": "send_message", "operation_hint": "slack:send_message", "order": 0}],
                        "logic": [],
                        "ambiguities": [],
                        "out_of_scope": []
                    }
                    import json as _json
                    return ProviderReply(text=_json.dumps(mock), tokens_in=100, tokens_out=200, cached_tokens=0)

                async def stream(self, **kwargs):
                    if False:
                        yield ""
                    return

                async def embed(self, **kwargs):
                    return [[0.0] * 8 for _ in kwargs.get("texts", [])]

            providers["openai"] = DevProvider()  # type: ignore

        _gateway = ModelGateway(
            providers=providers,
            cache=PromptCache(redis=_redis, ttl_seconds=_settings.cache_ttl_seconds),
            budgets=BudgetEnforcer(
                redis=_redis,
                daily_limit=Decimal(str(_settings.org_daily_budget_usd)),
                request_limit=Decimal(str(_settings.request_budget_usd)),
            ),
            usage=UsageRepository(
                client=_http,
                url=_settings.supabase_url,
                service_key=_settings.supabase_service_key.get_secret_value(),
            ),
            routes=_adapt_routes(providers),
            max_embedding_batch_size=_settings.max_embedding_batch_size,
        )
    return _gateway
