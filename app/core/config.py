from functools import lru_cache

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
