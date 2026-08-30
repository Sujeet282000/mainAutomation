# ============================================================================
# Orchestra Part 7 — Catalog Reindex CLI
# Source of truth: Part 7 § "The Catalog Index"
# Re-indexes piece embeddings for hybrid retrieval.
# ============================================================================

from __future__ import annotations

import asyncio
import hashlib

import httpx

from orchestra_ai.db.catalog import (
    EMBEDDING_TEXT_VERSION,
    CatalogRepository,
    content_hash,
    operation_embedding_text,
)
from orchestra_ai.gateway.gateway import ModelGateway, Purpose
from orchestra_ai.settings import get_settings


async def reindex(gateway: ModelGateway, catalog: CatalogRepository) -> dict:
    """Reindex all piece operations that need fresh embeddings."""
    settings = get_settings()
    model = settings.embedding_model
    provider_name = settings.embedding_provider

    # Find operations needing reindex
    cards = await catalog.cards_needing_reindex(model)
    print(f"Found {len(cards)} operations needing reindex")

    reindexed = 0
    errors = 0

    for card in cards:
        try:
            # Generate embedding text
            text = operation_embedding_text(card)

            # Generate embedding via configured provider
            provider = gateway._providers.get(provider_name) or gateway._providers.get("openai")
            if not provider:
                raise RuntimeError(f"No embedding provider available for {provider_name}")
            embeddings = await provider.embed(
                model=model,
                texts=[text],
            )

            if embeddings:
                await catalog.upsert_embedding(
                    operation_id=card["operation_id"],
                    card=card,
                    vector=embeddings[0],
                    model=model,
                )
                reindexed += 1
                print(f"  ✓ {card['operation_id']}")
        except Exception as e:
            errors += 1
            print(f"  ✗ {card['operation_id']}: {e}")

    return {"reindexed": reindexed, "errors": errors, "total": len(cards)}


async def main():
    """CLI entry point for catalog reindex."""
    settings = get_settings()

    import httpx
    from redis.asyncio import Redis
    from orchestra_ai.gateway.gateway import (
        BudgetEnforcer,
        ModelGateway,
        PromptCache,
        ROUTES,
        UsageRepository,
    )
    from orchestra_ai.gateway.providers import AnthropicAdapter, OpenAIAdapter, GeminiAdapter, LocalOpenAICompatibleAdapter
    from orchestra_ai.db.catalog import CatalogRepository
    from orchestra_ai.settings import live_secret

    timeout = httpx.Timeout(
        connect=settings.connect_timeout_seconds,
        read=settings.read_timeout_seconds,
        write=settings.model_timeout_seconds,
        pool=settings.connect_timeout_seconds,
    )
    http_client = httpx.AsyncClient(timeout=timeout)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)

    providers = {
        "openai": OpenAIAdapter(
            http_client,
            settings.openai_api_key.get_secret_value(),
            settings.openai_base_url,
        ),
        "anthropic": AnthropicAdapter(
            http_client,
            settings.anthropic_api_key.get_secret_value(),
            settings.anthropic_base_url,
        ),
        "local": LocalOpenAICompatibleAdapter(
            http_client, settings.local_api_key, settings.local_base_url,
        ),
    }
    if live_secret(settings.gemini_api_key):
        providers["google"] = GeminiAdapter(
            http_client, settings.gemini_api_key.get_secret_value(), settings.gemini_base_url,
        )

    gateway = ModelGateway(
        providers=providers,
        routes=ROUTES,
        cache=PromptCache(redis, settings.cache_ttl_seconds),
        budgets=BudgetEnforcer(
            redis, settings.org_daily_budget_usd, settings.request_budget_usd
        ),
        usage=UsageRepository(
            http_client,
            settings.supabase_url,
            settings.supabase_service_key.get_secret_value(),
        ),
        max_embedding_batch_size=settings.max_embedding_batch_size,
    )

    catalog = CatalogRepository(
        http_client,
        settings.supabase_url,
        settings.supabase_service_key.get_secret_value(),
    )

    result = await reindex(gateway, catalog)
    print(f"\nReindex complete: {result}")

    await redis.aclose()
    await http_client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
