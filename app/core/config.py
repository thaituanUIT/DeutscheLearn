from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "German Word Quiz"
    database_url: str = "sqlite:///./quiz.db"
    environment: str = "development"
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    cookie_max_age_seconds: int = 60 * 60 * 24 * 365
    seed_on_startup: bool = True
    admin_token: str | None = None

    @model_validator(mode="after")
    def require_persistent_database_in_production(self) -> "Settings":
        if self.environment == "production" and self.database_url.startswith("sqlite"):
            raise ValueError("DATABASE_URL must point to a persistent database in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
