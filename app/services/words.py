import random
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import CachedWord


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
    existing = set(db.scalars(select(CachedWord.word)).all())
    for item in SEED_WORDS:
        if item.word in existing:
            continue
        db.add(
            CachedWord(
                word=item.word,
                article=item.article,
                part_of_speech=item.part_of_speech,
                meaning=item.meaning,
            )
        )
    db.commit()


def get_random_word(db: Session, *, require_article: bool = False) -> CachedWord:
    query = select(CachedWord)
    if require_article:
        query = query.where(CachedWord.article.is_not(None))
    words = list(db.scalars(query).all())
    if not words:
        seed_words(db)
        words = list(db.scalars(query).all())
    return random.choice(words)
