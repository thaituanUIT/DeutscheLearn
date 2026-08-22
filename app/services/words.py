import random
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from typing import Any

import duden
from requests import RequestException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Word


@dataclass(frozen=True)
class WordSeed:
    word: str
    article: str | None
    part_of_speech: str
    meaning: str


SEED_WORDS = [
    WordSeed("Haus", "das", "noun", "A building where people live."),
    WordSeed("Zeit", "die", "noun", "Time or a period of time."),
    WordSeed("Tisch", "der", "noun", "A table used for eating or working."),
    WordSeed("Blume", "die", "noun", "A flowering plant."),
    WordSeed("Buch", "das", "noun", "A book with written or printed pages."),
    WordSeed("Stuhl", "der", "noun", "A chair for one person."),
    WordSeed("laufen", None, "verb", "To walk or run."),
    WordSeed("schreiben", None, "verb", "To write."),
    WordSeed("denken", None, "verb", "To think."),
    WordSeed("lernen", None, "verb", "To learn or study."),
    WordSeed("schnell", None, "adjective", "Fast or quick."),
    WordSeed("klein", None, "adjective", "Small."),
    WordSeed("freundlich", None, "adjective", "Friendly or kind."),
    WordSeed("heute", None, "adverb", "Today."),
    WordSeed("oft", None, "adverb", "Often."),
]


def seed_words(db: Session) -> None:
    existing = set(db.scalars(select(Word.lemma)).all())
    for item in SEED_WORDS:
        if item.word in existing:
            continue
        db.add(
            Word(
                lemma=item.word,
                article=item.article,
                part_of_speech=item.part_of_speech,
                meaning=item.meaning,
            )
        )
    db.commit()


def get_words(db: Session, *, require_article: bool = False) -> list[Word]:
    query = select(Word)
    if require_article:
        query = query.where(Word.article.is_not(None))
    words = list(db.scalars(query).all())
    if not words:
        seed_words(db)
        words = list(db.scalars(query).all())
    return words


def get_random_word(db: Session, *, require_article: bool = False) -> Word:
    words = get_words(db, require_article=require_article)
    return random.choice(words)


@dataclass(frozen=True)
class WordOfDay:
    word: str
    article: str | None
    part_of_speech: str
    meaning: str


def get_seeded_word_of_day(db: Session, today: date) -> WordOfDay:
    words = sorted(get_words(db), key=lambda item: item.word.casefold())
    days_since_epoch = today.toordinal()
    word = words[days_since_epoch % len(words)]
    return WordOfDay(
        word=word.word,
        article=word.article,
        part_of_speech=word.part_of_speech,
        meaning=word.meaning,
    )


def get_word_of_day(db: Session, today: date) -> WordOfDay:
    try:
        return duden_word_to_word_of_day(duden.get_word_of_the_day())
    except (AttributeError, IndexError, RequestException, RuntimeError, TypeError):
        return get_seeded_word_of_day(db, today)


def get_duden_meaning_overview(word: str) -> str:
    duden_meaning = _get_duden_meaning_overview(word)
    if duden_meaning:
        return duden_meaning
    return "No Duden meaning overview is available yet."


def get_meaning_overview(db: Session, word: str) -> str:
    cached_word = db.scalar(select(Word).where(Word.lemma == word))
    if cached_word is not None:
        return cached_word.meaning
    return get_duden_meaning_overview(word)


@lru_cache(maxsize=256)
def _get_duden_meaning_overview(word: str) -> str | None:
    try:
        matches = duden.search(word, exact=True)
    except (AttributeError, IndexError, RequestException, RuntimeError, TypeError):
        return None

    if not matches:
        return None
    pieces = _flatten_meaning(getattr(matches[0], "meaning_overview", None))
    return "; ".join(pieces) if pieces else None


def duden_word_to_word_of_day(word: Any) -> WordOfDay:
    return WordOfDay(
        word=str(word.name).strip(),
        article=_clean_optional_text(getattr(word, "article", None)),
        part_of_speech=_clean_optional_text(getattr(word, "part_of_speech", None)) or "Duden",
        meaning=_meaning_to_text(getattr(word, "meaning_overview", None)),
    )


def _clean_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split())
    return text or None


def _meaning_to_text(value: Any) -> str:
    pieces = _flatten_meaning(value)
    return "; ".join(pieces) if pieces else "See the full Duden entry for details."


def _flatten_meaning(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = " ".join(value.split())
        return [text] if text else []
    if isinstance(value, dict):
        pieces: list[str] = []
        for nested in value.values():
            pieces.extend(_flatten_meaning(nested))
        return pieces
    if isinstance(value, list | tuple | set):
        pieces = []
        for nested in value:
            pieces.extend(_flatten_meaning(nested))
        return pieces
    text = " ".join(str(value).split())
    return [text] if text else []
