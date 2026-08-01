import csv
import random
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models import CachedWord, FocusWordEntry

FOCUS_CSV_PATH = Path("data/focus_words.csv")
FOCUS_LEVELS = ["A1", "A2", "B1", "B2"]
TOPIC_LABELS = {
    "art_painting": "Art & Painting",
    "clothing_appearance": "Clothing & Appearance",
    "daily_routine": "Daily Routine",
    "economy_consumption": "Economy & Consumption",
    "education_studies": "Education & Studies",
    "food_drink": "Food & Drink",
    "health_body": "Health & Body",
    "hotel_accommodation_reception": "Hotel, Accommodation & Reception",
    "housing_furniture": "Housing & Furniture",
    "kitchen_utensils": "Kitchen Utensils",
    "media_technology": "Media & Technology",
    "psychology_personality": "Psychology & Personality",
    "relationships_living_together": "Relationships & Living Together",
    "self_introduction_family": "Self Introduction & Family",
    "shopping_prices": "Shopping & Prices",
    "travel_transport": "Travel & Transport",
    "weather_seasons": "Weather & Seasons",
    "work_career": "Work & Career",
}


@dataclass(frozen=True)
class FocusCsvRow:
    word: str
    topic: str
    level: str
    article: str | None
    part_of_speech: str
    meaning: str


def import_focus_words(db: Session, csv_path: Path = FOCUS_CSV_PATH) -> None:
    if not csv_path.exists():
        return

    rows = _read_focus_rows(csv_path)
    for row in _unique_word_rows(rows):
        word = db.get(CachedWord, row.word)
        if word is None:
            word = CachedWord(
                word=row.word,
                article=row.article,
                part_of_speech=row.part_of_speech,
                meaning=row.meaning,
            )
            db.add(word)
        else:
            word.article = row.article
            word.part_of_speech = row.part_of_speech
            word.meaning = row.meaning

    db.execute(delete(FocusWordEntry))
    db.flush()
    for row in rows:
        db.add(FocusWordEntry(word=row.word, topic=row.topic, level=row.level))
    db.commit()


def get_focus_levels(db: Session) -> list[dict[str, int | str]]:
    counts = dict(
        db.execute(
            select(FocusWordEntry.level, func.count(FocusWordEntry.id))
            .group_by(FocusWordEntry.level)
        ).all()
    )
    topic_counts = dict(
        db.execute(
            select(FocusWordEntry.level, func.count(func.distinct(FocusWordEntry.topic)))
            .group_by(FocusWordEntry.level)
        ).all()
    )
    return [
        {
            "level": level,
            "word_count": counts.get(level, 0),
            "topic_count": topic_counts.get(level, 0),
        }
        for level in FOCUS_LEVELS
    ]


def get_focus_topics(db: Session, level: str) -> list[dict[str, int | str]]:
    rows = db.execute(
        select(FocusWordEntry.topic, func.count(FocusWordEntry.id))
        .where(FocusWordEntry.level == level)
        .group_by(FocusWordEntry.topic)
        .order_by(FocusWordEntry.topic)
    ).all()
    return [
        {
            "topic": topic,
            "label": TOPIC_LABELS.get(topic, _topic_to_label(topic)),
            "word_count": count,
        }
        for topic, count in rows
    ]


def get_focus_cards(db: Session, level: str, topic: str) -> list[dict[str, str | None]]:
    rows = db.execute(
        select(FocusWordEntry, CachedWord)
        .join(CachedWord, CachedWord.word == FocusWordEntry.word)
        .where(FocusWordEntry.level == level, FocusWordEntry.topic == topic)
        .order_by(FocusWordEntry.word)
    ).all()
    return [
        {
            "word": word.word,
            "article": word.article,
            "part_of_speech": word.part_of_speech,
            "meaning_overview": word.meaning,
            "topic": entry.topic,
            "topic_label": TOPIC_LABELS.get(entry.topic, _topic_to_label(entry.topic)),
            "level": entry.level,
        }
        for entry, word in rows
    ]


def get_focus_revision_questions(
    db: Session,
    level: str,
    topic: str,
    *,
    limit: int = 5,
) -> list[dict[str, str | list[str] | None]]:
    topic_rows = db.execute(
        select(FocusWordEntry, CachedWord)
        .join(CachedWord, CachedWord.word == FocusWordEntry.word)
        .where(FocusWordEntry.level == level, FocusWordEntry.topic == topic)
    ).all()
    if not topic_rows:
        return []

    selected_rows = random.sample(topic_rows, k=min(limit, len(topic_rows)))
    global_meanings = list(
        dict.fromkeys(
            meaning
            for meaning in db.scalars(select(CachedWord.meaning)).all()
            if meaning.strip()
        )
    )

    questions = []
    for entry, word in selected_rows:
        correct_answer = word.meaning
        distractors = [meaning for meaning in global_meanings if meaning != correct_answer]
        choices = random.sample(distractors, k=min(2, len(distractors)))
        choices.append(correct_answer)
        random.shuffle(choices)
        questions.append(
            {
                "word": word.word,
                "article": word.article,
                "part_of_speech": word.part_of_speech,
                "meaning_overview": word.meaning,
                "topic": entry.topic,
                "topic_label": TOPIC_LABELS.get(entry.topic, _topic_to_label(entry.topic)),
                "level": entry.level,
                "choices": choices,
                "correct_answer": correct_answer,
            }
        )
    return questions


def _read_focus_rows(csv_path: Path) -> list[FocusCsvRow]:
    with csv_path.open(encoding="utf-8", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        rows = [
            FocusCsvRow(
                word=row["word"].strip(),
                topic=row["topic"].strip(),
                level=row["level"].strip().upper(),
                article=_clean_optional_csv_value(row.get("article", "")),
                part_of_speech=row.get("part_of_speech", "").strip() or "unknown",
                meaning=row.get("meaning", "").strip() or "No meaning is available yet.",
            )
            for row in reader
        ]
    return [row for row in rows if row.word and row.topic and row.level]


def _unique_word_rows(rows: list[FocusCsvRow]) -> list[FocusCsvRow]:
    seen = set()
    unique_rows = []
    for row in rows:
        if row.word in seen:
            continue
        seen.add(row.word)
        unique_rows.append(row)
    return unique_rows


def _clean_optional_csv_value(value: str) -> str | None:
    text = value.strip()
    return text or None


def _topic_to_label(topic: str) -> str:
    return " ".join(piece.capitalize() for piece in topic.split("_"))
