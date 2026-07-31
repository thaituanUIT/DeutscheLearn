import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_production_requires_persistent_database_url() -> None:
    with pytest.raises(ValidationError, match="persistent database"):
        Settings(environment="production", database_url="sqlite:///./quiz.db")


def test_development_allows_sqlite_database_url() -> None:
    settings = Settings(environment="development", database_url="sqlite:///./quiz.db")

    assert settings.database_url == "sqlite:///./quiz.db"
