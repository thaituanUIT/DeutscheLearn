from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.api.dictation import (
    enforce_dictation_fetch_limits,
    enforce_dictation_report_limits,
    group_transcript_snippets,
    youtube_video_id,
)
from app.core.config import Settings
from app.db.models import (
    DictationFetchCounter,
    DictationModerationEvent,
    DictationVideo,
    DictationVideoReport,
)
from app.db.session import SessionLocal
from app.main import app


def clear_dictation_counters() -> None:
    with SessionLocal() as db:
        db.execute(delete(DictationFetchCounter))
        db.commit()


def dictation_settings(**overrides: object) -> Settings:
    defaults: dict[str, object] = {
        "dictation_new_videos_per_ip_hour": 10,
        "dictation_new_videos_per_ip_day": 10,
        "dictation_global_new_videos_per_day": 10,
        "dictation_reports_per_ip_day": 10,
        "dictation_global_reports_per_day": 10,
        "dictation_rate_limit_salt": "dictation-test-salt",
    }
    defaults.update(overrides)
    return Settings(**defaults)


def new_video(*, report_count: int = 0, is_hidden: bool = False, created_at=None) -> DictationVideo:
    video_id = uuid4().hex[:11]
    return DictationVideo(
        video_id=video_id,
        video_url=f"https://www.youtube.com/watch?v={video_id}",
        title="Test dictation video",
        language="German",
        is_generated=False,
        segments=[{"start": 0, "duration": 1, "text": "Guten Morgen."}],
        segment_count=1,
        report_count=report_count,
        is_hidden=is_hidden,
        created_at=created_at or datetime.now(UTC),
    )


def test_youtube_video_id_accepts_supported_link_shapes() -> None:
    assert youtube_video_id("https://youtu.be/abcdefghijk?t=12") == "abcdefghijk"
    assert youtube_video_id("https://www.youtube.com/watch?v=abcdefghijk") == "abcdefghijk"
    assert youtube_video_id("https://youtube.com/shorts/abcdefghijk") == "abcdefghijk"


def test_youtube_video_id_rejects_non_youtube_hosts() -> None:
    with pytest.raises(HTTPException) as error:
        youtube_video_id("https://youtube.com.attacker.example/watch?v=abcdefghijk")

    assert error.value.status_code == 422


def test_group_transcript_snippets_normalizes_spacing_and_timing() -> None:
    result = group_transcript_snippets(
        [SimpleNamespace(start=1.23456, duration=2.5, text="  Guten   Morgen!  ")]
    )

    assert len(result) == 1
    assert result[0].text == "Guten Morgen!"
    assert result[0].start == 1.235
    assert result[0].duration == 2.5


def test_fetch_quota_reserves_ip_limits_without_overcounting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clear_dictation_counters()
    settings = dictation_settings(dictation_new_videos_per_ip_hour=1)
    monkeypatch.setattr("app.api.dictation.get_settings", lambda: settings)

    with SessionLocal() as db:
        enforce_dictation_fetch_limits(db, "203.0.113.8")
        with pytest.raises(HTTPException) as error:
            enforce_dictation_fetch_limits(db, "203.0.113.8")

        assert error.value.status_code == 429
        counters = db.scalars(select(DictationFetchCounter)).all()
        assert len(counters) == 3
        assert all(counter.request_count == 1 for counter in counters)


def test_fetch_quota_enforces_global_limit_atomically(monkeypatch: pytest.MonkeyPatch) -> None:
    clear_dictation_counters()
    settings = dictation_settings(dictation_global_new_videos_per_day=1)
    monkeypatch.setattr("app.api.dictation.get_settings", lambda: settings)

    with SessionLocal() as db:
        enforce_dictation_fetch_limits(db, "203.0.113.9")
        with pytest.raises(HTTPException) as error:
            enforce_dictation_fetch_limits(db, "203.0.113.10")

        assert error.value.status_code == 503
        global_counter = db.get(DictationFetchCounter, f"global:day:{datetime.now(UTC):%Y%m%d}")
        assert global_counter is not None
        assert global_counter.request_count == 1


def test_report_quota_does_not_consume_fetch_quota(monkeypatch: pytest.MonkeyPatch) -> None:
    clear_dictation_counters()
    settings = dictation_settings(
        dictation_reports_per_ip_day=1, dictation_global_reports_per_day=1
    )
    monkeypatch.setattr("app.api.dictation.get_settings", lambda: settings)

    with SessionLocal() as db:
        enforce_dictation_report_limits(db, "203.0.113.11")
        report_counters = db.scalars(select(DictationFetchCounter)).all()
        assert len(report_counters) == 2
        assert all(
            counter.bucket_key.startswith(("client-report:", "global-report:"))
            for counter in report_counters
        )

        enforce_dictation_fetch_limits(db, "203.0.113.11")
        with pytest.raises(HTTPException) as error:
            enforce_dictation_report_limits(db, "203.0.113.11")

        assert error.value.status_code == 429
        fetch_counters = db.scalars(
            select(DictationFetchCounter).where(
                DictationFetchCounter.bucket_key.startswith("client:")
            )
        ).all()
        assert len(fetch_counters) == 2


def test_dictation_video_catalog_supports_offset_pagination() -> None:
    start = datetime.now(UTC) + timedelta(days=1)
    videos = [new_video(created_at=start) for _ in range(3)]
    expected_ids = {video.video_id for video in videos}
    with SessionLocal() as db:
        db.add_all(videos)
        db.commit()

    with TestClient(app) as client:
        first_page = client.get("/api/dictation/videos?limit=2&offset=0")
        second_page = client.get("/api/dictation/videos?limit=2&offset=2")

    assert first_page.status_code == 200
    assert second_page.status_code == 200
    first_ids = {video["video_id"] for video in first_page.json()} & expected_ids
    second_ids = {video["video_id"] for video in second_page.json()} & expected_ids
    assert len(first_ids) == 2
    assert len(second_ids) == 1
    assert first_ids.isdisjoint(second_ids)


def test_cached_transcript_does_not_reserve_fetch_quota() -> None:
    clear_dictation_counters()
    video = new_video()
    video_id = video.video_id
    with SessionLocal() as db:
        db.add(video)
        db.commit()

    with TestClient(app) as client:
        response = client.post(
            "/api/dictation/transcript",
            json={"video_url": f"https://www.youtube.com/watch?v={video_id}"},
        )

    assert response.status_code == 200
    assert response.json()["cache_hit"] is True
    with SessionLocal() as db:
        assert db.scalars(select(DictationFetchCounter)).all() == []


def test_full_library_does_not_consume_attempt_and_still_serves_cached_video(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clear_dictation_counters()
    video = new_video()
    video_id = video.video_id
    with SessionLocal() as db:
        db.add(video)
        db.commit()
    monkeypatch.setattr("app.api.dictation.get_settings", lambda: dictation_settings(
        dictation_max_saved_videos=1,
    ))
    with TestClient(app) as client:
        rejected = client.post("/api/dictation/transcript", json={
            "video_url": f"https://youtu.be/{uuid4().hex[:11]}",
        })
        cached = client.post("/api/dictation/transcript", json={
            "video_url": f"https://youtu.be/{video_id}",
        })
    assert rejected.status_code == 507
    assert cached.status_code == 200
    with SessionLocal() as db:
        assert db.scalars(select(DictationFetchCounter)).all() == []


@pytest.mark.parametrize("limit", ["characters", "segments", "snippets"])
def test_size_rejection_refunds_only_its_attempt(
    monkeypatch: pytest.MonkeyPatch, limit: str,
) -> None:
    from youtube_transcript_api import YouTubeTranscriptApi

    clear_dictation_counters()
    settings = dictation_settings(
        dictation_new_videos_per_ip_hour=2,
        dictation_max_transcript_chars=1000 if limit == "characters" else 100000,
        dictation_max_transcript_segments=10,
    )
    monkeypatch.setattr("app.api.dictation.get_settings", lambda: settings)

    class Transcript(list):
        language = "German (auto-generated)"
        is_generated = True

    text = "Guten Morgen, heute üben wir die deutsche Sprache."
    if limit == "characters":
        snippets = [SimpleNamespace(start=0, duration=30, text=text * 30)]
    elif limit == "segments":
        snippets = [SimpleNamespace(start=i * 3, duration=2, text=text) for i in range(11)]
    else:
        snippets = [SimpleNamespace(start=i, duration=1, text="[Musik]") for i in range(5000)]
        snippets.append(SimpleNamespace(start=5000, duration=3, text=text))
    track = SimpleNamespace(language_code="de", is_generated=True, fetch=lambda: Transcript(snippets))
    monkeypatch.setattr(YouTubeTranscriptApi, "list", lambda self, video_id: [track])
    with SessionLocal() as db:
        enforce_dictation_fetch_limits(db, "testclient")
        before = dict(db.execute(select(
            DictationFetchCounter.bucket_key, DictationFetchCounter.request_count,
        )).all())
    with TestClient(app) as client:
        for _ in range(2):
            response = client.post("/api/dictation/transcript", json={
                "video_url": f"https://youtu.be/{uuid4().hex[:11]}",
            })
            assert response.status_code == 413
    with SessionLocal() as db:
        after = dict(db.execute(select(
            DictationFetchCounter.bucket_key, DictationFetchCounter.request_count,
        )).all())
    assert after == before


def test_admin_can_hide_and_restore_reported_video(monkeypatch: pytest.MonkeyPatch) -> None:
    clear_dictation_counters()
    video = new_video(report_count=2)
    video_id = video.video_id
    with SessionLocal() as db:
        db.add(video)
        db.commit()
    monkeypatch.setattr("app.api.security.get_settings", lambda: Settings(admin_token="test-admin"))

    with TestClient(app) as client:
        headers = {"Authorization": "Bearer test-admin"}
        queue = client.get("/api/admin/dictation/reports", headers=headers)
        hidden = client.patch(
            f"/api/admin/dictation/videos/{video_id}",
            headers=headers,
            json={"is_hidden": True},
        )
        visible_catalog = client.get("/api/dictation/videos")
        restored = client.patch(
            f"/api/admin/dictation/videos/{video_id}",
            headers=headers,
            json={"is_hidden": False},
        )

    assert queue.status_code == 200
    assert any(item["video_id"] == video_id for item in queue.json())
    assert hidden.status_code == 200
    assert hidden.json()["is_hidden"] is True
    assert all(item["video_id"] != video_id for item in visible_catalog.json())
    assert restored.status_code == 200
    assert restored.json()["is_hidden"] is False


def test_moderation_reasons_and_history_survive_reload_without_reporter_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    video = new_video(report_count=3)
    video_id = video.video_id
    with SessionLocal() as db:
        db.add(video)
        db.flush()
        db.add_all(
            [
                DictationVideoReport(
                    video_id=video_id, reporter_key="private-one", reason="not_german"
                ),
                DictationVideoReport(
                    video_id=video_id, reporter_key="private-two", reason="not_german"
                ),
                DictationVideoReport(
                    video_id=video_id, reporter_key="private-three", reason="broken"
                ),
            ]
        )
        db.commit()
    monkeypatch.setattr("app.api.security.get_settings", lambda: Settings(admin_token="test-admin"))
    headers = {"Authorization": "Bearer test-admin"}
    with TestClient(app) as client:
        assert client.get("/api/admin/dictation/reports").status_code == 401
        for hidden in (True, True, False):
            response = client.patch(
                f"/api/admin/dictation/videos/{video_id}",
                headers=headers,
                json={"is_hidden": hidden},
            )
            assert response.status_code == 200
        response = client.get("/api/admin/dictation/reports", headers=headers)
    item = next(item for item in response.json() if item["video_id"] == video_id)
    assert item["report_reasons"] == {"not_german": 2, "broken": 1}
    assert [event["is_hidden"] for event in item["review_history"]] == [False, True]
    assert all(event["created_at"].endswith("Z") for event in item["review_history"])
    assert "private-one" not in response.text
    with SessionLocal() as db:
        events = db.scalars(
            select(DictationModerationEvent).where(DictationModerationEvent.video_id == video_id)
        ).all()
    assert len(events) == 2
