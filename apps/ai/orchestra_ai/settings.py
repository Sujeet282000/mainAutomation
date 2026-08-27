# ============================================================================
# Orchestra Part 7 — Settings (fail-fast, immutable after construction)
# Source of truth: Part 7 § "settings.py : explicit, fail-fast configuration"
# ============================================================================

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ENV = Path(__file__).resolve().parents[3] / ".env"
_APP_ENV = Path(__file__).resolve().parents[1] / ".env"

PLACEHOLDER_KEYS = {
    "",
    "replace-with-provider-secret",
    "replace-with-a-48-plus-character-random-secret",
}


def live_secret(value: SecretStr | None) -> str | None:
    if value is None:
        return None
    raw = value.get_secret_value().strip()
    if not raw or raw.lower() in PLACEHOLDER_KEYS or raw.lower().startswith("replace-"):
        return None
    if raw.lower().startswith("xox"):
        return None
    return raw


class RouteSettings(BaseSettings):
    model_config = SettingsConfigDict(extra="forbid")

    provider: Literal["openai", "anthropic"]
    model: str
    fallback_provider: Literal["openai", "anthropic"] | None = None
    fallback_model: str | None = None
    temperature: float = Field(ge=0, le=2)
    max_tokens: int = Field(ge=1, le=32_768)

    @model_validator(mode="after")
    def validate_fallback(self) -> "RouteSettings":
        paired = self.fallback_provider is not None
        if paired != (self.fallback_model is not None):
            raise ValueError(
                "fallback_provider and fallback_model must be configured together"
            )
        return self


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(_REPO_ENV), str(_APP_ENV), ".env"),
        env_file_encoding="utf-8",
        env_nested_delimiter=" ",
        extra="ignore",
        frozen=True,
    )

    environment: Literal["development", "test", "staging", "production"] = "development"
    log_level: str = "INFO"
    service_name: str = "ai-service"

    # Service authentication
    service_token: SecretStr = Field(default="dev-service-token-change-me-32ch", alias="SERVICE_TOKEN")
    service_token_max_age_seconds: int = Field(default=300, ge=10, le=300)

    # Provider keys
    openai_api_key: SecretStr | None = Field(default=None, alias="OPENAI_API_KEY")
    anthropic_api_key: SecretStr | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    openai_base_url: str = "https://api.openai.com/v1"
    anthropic_base_url: str = "https://api.anthropic.com"
    byo_key_kms_key_id: str = Field(default="dev-kms-key", alias="BYO_KEY_KMS_KEY_ID")

    # Supabase
    supabase_url: str = Field(default="http://localhost:54324", alias="SUPABASE_URL")
    supabase_service_key: SecretStr = Field(default="dev-service-key", alias="SUPABASE_SERVICE_KEY")

    node_api_url: str = Field(default="http://localhost:4000", alias="NODE_API_URL")

    # Redis
    redis_url: str = Field(default="redis://localhost:6379", alias="REDIS_URL")

    # Timeouts
    connect_timeout_seconds: float = Field(default=3, gt=0, le=30)
    read_timeout_seconds: float = Field(default=65, gt=0, le=120)
    model_timeout_seconds: float = Field(default=70, gt=0, le=120)

    # Cache
    cache_ttl_seconds: int = Field(default=3600, ge=0, le=86_400)
    catalog_cache_ttl_seconds: int = Field(default=900, ge=0, le=86_400)
    prompt_cache_ttl_seconds: int = Field(default=3600, ge=0, le=86_400)

    # Budgets
    org_daily_budget_usd: float = Field(default=50.0, gt=0)
    request_budget_usd: float = Field(default=5.0, gt=0)
    max_embedding_batch_size: int = Field(default=100, ge=1, le=2000)

    # Model routes (loaded from env as nested)
    routes: dict[str, RouteSettings] = Field(default_factory=dict)


@lru_cache
def get_settings() -> Settings:
    return Settings()
