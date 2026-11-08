import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

from app.core.config import Settings
from app.main import app


def test_new_passages_are_drafts_until_explicitly_published(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.api.admin.get_settings", lambda: Settings(admin_token="test-admin"))
    payload = {
        "title": f"Admin workflow {uuid4().hex}",
        "group": "general",
        "level": "A1",
        "passage_text": "Der Kurs beginnt am Montag.",
        "questions": [],
    }
    headers = {"Authorization": "Bearer test-admin"}
    with TestClient(app) as client:
        created = client.post("/api/admin/reading/passages", headers=headers, json=payload)
        assert created.status_code == 200
        draft = created.json()
        assert draft["status"] == "draft"
        published = client.patch(
            f"/api/admin/reading/passages/{draft['id']}",
            headers=headers,
            json={**draft, "status": "published"},
        )
        assert published.status_code == 200
        assert published.json()["status"] == "published"


def test_moderation_history_migration_round_trip() -> None:
    path = Path("alembic/versions/b02e7d943a10_add_dictation_moderation_history.py")
    spec = importlib.util.spec_from_file_location("moderation_history_migration", path)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE dictation_videos (video_id VARCHAR(11) PRIMARY KEY)"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert "dictation_moderation_events" in inspect(connection).get_table_names()
            migration.downgrade()
            assert "dictation_moderation_events" not in inspect(connection).get_table_names()


def test_word_pagination_does_not_repeat_words_with_multiple_topics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.api.admin.get_settings", lambda: Settings(admin_token="test-admin"))
    prefix = f"pagination-{uuid4().hex}"
    headers = {"Authorization": "Bearer test-admin"}
    with TestClient(app) as client:
        for index in range(3):
            created = client.post(
                "/api/admin/words",
                headers=headers,
                json={
                    "word": f"{prefix}-{index}",
                    "part_of_speech": "verb",
                    "meaning": "test meaning",
                    "focus_entries": [
                        {"level": "A1", "topic": "housing_furniture"},
                        {"level": "A1", "topic": "education_studies"},
                    ],
                },
            )
            assert created.status_code == 200
        params = {"search": prefix, "level": "A1", "limit": 2}
        first = client.get("/api/admin/words", headers=headers, params=params).json()
        second = client.get(
            "/api/admin/words", headers=headers, params={**params, "offset": 2}
        ).json()
    assert [word["word"] for word in first + second] == [f"{prefix}-{index}" for index in range(3)]
