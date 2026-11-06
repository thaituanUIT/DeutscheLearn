"""Normalize saved dictation captions; preview by default, write with --apply.

Run from the project root: uv run python -m scripts.normalize_dictation --apply
"""

import argparse
import json
import os
import tempfile
from pathlib import Path

from sqlalchemy import select

from app.db.models import DictationVideo
from app.db.session import SessionLocal
from app.services.dictation import normalize_dictation_segments


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", default="German (auto-generated)")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    changed = []
    backup = []
    removed = 0
    with SessionLocal() as db:
        query = select(DictationVideo).where(DictationVideo.language == args.language)
        if args.apply:
            query = query.with_for_update()
        videos = db.scalars(query).all()
        for video in videos:
            segments = normalize_dictation_segments(video.segments)
            if segments == video.segments and video.segment_count == len(segments):
                continue
            backup.append({
                "video_id": video.video_id,
                "language": video.language,
                "segments": video.segments,
                "segment_count": video.segment_count,
                "is_hidden": video.is_hidden,
            })
            removed += len(video.segments) - len(segments)
            changed.append(video.video_id)
            video.segments = segments
            video.segment_count = len(segments)
            if not segments:
                video.is_hidden = True
        backup_path = None
        if args.apply and changed:
            # Persist originals before committing any updates. mkstemp uses mode 0600.
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", prefix="dictation-normalization-",
                suffix=".json", delete=False,
            ) as file:
                json.dump(backup, file, ensure_ascii=False, indent=2)
                file.flush()
                os.fsync(file.fileno())
                backup_path = str(Path(file.name))
            db.commit()
        print(json.dumps({
            "applied": args.apply,
            "language": args.language,
            "matched_videos": len(videos),
            "changed_videos": len(changed),
            "removed_segments": removed,
            "empty_videos_hidden": sum(not item.segments for item in videos if item.video_id in changed),
            "backup_path": backup_path,
        }, indent=2))


if __name__ == "__main__":
    main()
