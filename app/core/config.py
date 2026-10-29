from functools import lru_cache

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "DeutscheLearn"
    database_url: str = "sqlite:///./quiz.db"
    environment: str = "development"
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    cookie_max_age_seconds: int = 60 * 60 * 24 * 365
    seed_on_startup: bool = True
    admin_token: str | None = None
    admin_key: str | None = None
    supabase_url: str | None = None
    supabase_service_role_key: str | None = None
    cohere_api_key: str | None = None
    cohere_embedding_model: str = "embed-multilingual-v3.0"
    cohere_embedding_dimension: int = 1024
    openrouter_api_key: str | None = None
    openrouter_chat_model: str = "google/gemma-4-31b-it:free"
    openrouter_chat_fallback_models: str = "openrouter/free"
    openrouter_http_referer: str | None = None
    openrouter_app_title: str = "DeutscheLearn"
    webshare_proxy_username: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "WEBSHARE_PROXY_USERNAME",
            "WEBSHARE_USERNAME",
            "PROXY_USERNAME",
            "webshare_proxy_username",
        ),
    )
    webshare_proxy_password: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "WEBSHARE_PROXY_PASSWORD",
            "WEBSHARE_PASSWORD",
            "PROXY_PASSWORD",
            "webshare_proxy_password",
        ),
    )
    dictation_new_videos_per_ip_hour: int = Field(default=3, ge=1, le=100)
    dictation_new_videos_per_ip_day: int = Field(default=10, ge=1, le=500)
    dictation_global_new_videos_per_day: int = Field(default=10, ge=1, le=10000)
    dictation_rate_limit_salt: str | None = None
    dictation_max_transcript_chars: int = Field(default=20000, ge=1000, le=100000)
    dictation_max_transcript_segments: int = Field(default=500, ge=10, le=5000)
    dictation_max_saved_videos: int = Field(default=500, ge=1, le=50000)
    dictation_reports_per_ip_day: int = Field(default=5, ge=1, le=100)
    dictation_global_reports_per_day: int = Field(default=100, ge=1, le=10000)
    grammar_rate_limit_per_hour: int = 10
    grammar_similarity_threshold: float = 0.45
    grammar_relative_similarity_threshold: float = 0.85
    grammar_min_query_words: int = 3
    static_assets_enabled: bool = True

    @model_validator(mode="after")
    def require_persistent_database_in_production(self) -> "Settings":
        if not self.admin_token and self.admin_key:
            self.admin_token = self.admin_key
        if self.cohere_embedding_model != "embed-multilingual-v3.0":
            raise ValueError(
                "COHERE_EMBEDDING_MODEL is pinned to embed-multilingual-v3.0; "
                "changing it requires a vector schema migration and full re-embed"
            )
        if self.cohere_embedding_dimension != 1024:
            raise ValueError(
                "COHERE_EMBEDDING_DIMENSION is pinned to 1024 for embed-multilingual-v3.0"
            )
        if self.environment == "production" and self.database_url.startswith("sqlite"):
            raise ValueError("DATABASE_URL must point to a persistent database in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
