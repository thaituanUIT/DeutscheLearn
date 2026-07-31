import random

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AnonymousPlayer

ADJECTIVES = [
    "Klug",
    "Mutig",
    "Froh",
    "Still",
    "Hell",
    "Stark",
    "Sanft",
    "Fein",
    "Flott",
    "Klar",
]

NOUNS = [
    "Stern",
    "Wald",
    "Fluss",
    "Mond",
    "Dichter",
    "Klang",
    "Berg",
    "Licht",
    "Herz",
    "Wort",
]


def generate_unique_display_name(db: Session) -> str:
    for _ in range(25):
        name = f"{random.choice(ADJECTIVES)}{random.choice(NOUNS)}{random.randint(100, 999)}"
        exists = db.scalar(select(AnonymousPlayer.id).where(AnonymousPlayer.display_name == name))
        if not exists:
            return name
    return f"WortSpieler{random.randint(100000, 999999)}"
