import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.admin import router as admin_router
from app.api.admin_reading import router as admin_reading_router
from app.api.content import router as content_router
from app.api.deps import get_or_create_player
from app.api.dictation import router as dictation_router
from app.api.grammar import router as grammar_router
from app.api.quiz import router as quiz_router
from app.core.time import utc_now
from app.db.models import (
    AnonymousPlayer,
)
from app.db.session import get_db
from app.schemas import (
    PlayerOut,
    WordOfDayOut,
)
from app.services.words import get_word_of_day

router = APIRouter(prefix="/api")
router.include_router(dictation_router)
router.include_router(grammar_router)
router.include_router(content_router)
router.include_router(admin_router)
router.include_router(admin_reading_router)
router.include_router(quiz_router)
logger = logging.getLogger(__name__)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/players/me", response_model=PlayerOut)
def me(player: AnonymousPlayer = Depends(get_or_create_player)) -> PlayerOut:
    return PlayerOut(
        player_id=player.id,
        display_name=player.display_name,
        best_endless_score=player.best_endless_score,
    )


@router.get("/word-of-the-day", response_model=WordOfDayOut)
def word_of_the_day(db: Session = Depends(get_db)) -> WordOfDayOut:
    today = utc_now().date()
    word = get_word_of_day(db, today)
    return WordOfDayOut(
        word=word.word,
        article=word.article,
        part_of_speech=word.part_of_speech,
        meaning=word.meaning,
        date=today.isoformat(),
    )
