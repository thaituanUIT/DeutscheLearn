import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.api.dictation import group_transcript_snippets
from app.db.models import DictationVideo
from app.db.session import SessionLocal
from app.services.dictation import normalize_dictation_segments, normalize_dictation_text
from scripts.normalize_dictation import main as normalize_saved_videos


@pytest.mark.parametrize(("raw", "expected"), [
    ("[Musik]", ""),
    ("[MUSIK] Guten   Morgen! [Applaus]", "Guten Morgen!"),
    ("Guten [leise Musik] Morgen [Lachen] !", "Guten Morgen!"),
    ("(music) Hallo. [laughter]", "Hallo."),
    ("Wir sind in [Berlin] (seit gestern).", "Wir sind in [Berlin] (seit gestern)."),
    ("Musik ist schön.", "Musik ist schön."),
    ("scho\u0308n\n hier", "schön hier"),
])
def test_normalize_dictation_text(raw: str, expected: str) -> None:
    assert normalize_dictation_text(raw) == expected
    assert normalize_dictation_text(expected) == expected


def test_saved_segments_preserve_timing_and_remove_cue_only_segments() -> None:
    segments = [
        {"start": 0, "duration": 2, "text": "[Musik]"},
        {"start": 2, "duration": 3, "text": "Hallo [Applaus] Welt!", "extra": "keep"},
    ]
    result = normalize_dictation_segments(segments)
    assert result == [{"start": 2, "duration": 3, "text": "Hallo Welt!", "extra": "keep"}]
    assert segments[1]["text"] == "Hallo [Applaus] Welt!"
    assert normalize_dictation_segments(result) == result


def test_ingestion_removes_cues_before_grouping() -> None:
    segments = group_transcript_snippets([
        SimpleNamespace(start=0, duration=2, text="[Musik]"),
        SimpleNamespace(start=3, duration=2, text="Guten [Applaus] Morgen!"),
    ])
    assert len(segments) == 1
    assert segments[0].text == "Guten Morgen!"
    assert segments[0].start == 3
    assert segments[0].duration == 2


def test_backfill_preview_apply_language_filter_and_idempotence(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path,
) -> None:
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    ids = [uuid4().hex[:11] for _ in range(3)]
    with SessionLocal() as db:
        for index, video_id in enumerate(ids):
            db.add(DictationVideo(
                video_id=video_id, video_url=f"https://youtu.be/{video_id}", title="Normalization test",
                language="German" if index == 1 else "German (auto-generated)",
                is_generated=index != 1,
                segments=[{"start": 4, "duration": 2, "text": "[Musik]" if index == 2 else "Hallo [Musik] Welt!"}],
                segment_count=1, is_hidden=False,
            ))
        db.commit()
    monkeypatch.setattr(sys, "argv", ["normalize_dictation"])
    normalize_saved_videos()
    preview = json.loads(capsys.readouterr().out)
    assert preview["changed_videos"] == 2
    assert preview["backup_path"] is None
    with SessionLocal() as db:
        assert "[Musik]" in db.get(DictationVideo, ids[0]).segments[0]["text"]

    monkeypatch.setattr(sys, "argv", ["normalize_dictation", "--apply"])
    normalize_saved_videos()
    applied = json.loads(capsys.readouterr().out)
    assert applied["changed_videos"] == 2
    originals = json.loads(Path(applied["backup_path"]).read_text())
    assert {item["video_id"] for item in originals} == {ids[0], ids[2]}
    with SessionLocal() as db:
        cleaned = db.get(DictationVideo, ids[0])
        assert cleaned.segments == [{"start": 4, "duration": 2, "text": "Hallo Welt!"}]
        assert cleaned.segment_count == 1
        assert "[Musik]" in db.get(DictationVideo, ids[1]).segments[0]["text"]
        empty = db.get(DictationVideo, ids[2])
        assert empty.segments == []
        assert empty.segment_count == 0
        assert empty.is_hidden
    normalize_saved_videos()
    assert json.loads(capsys.readouterr().out)["changed_videos"] == 0
