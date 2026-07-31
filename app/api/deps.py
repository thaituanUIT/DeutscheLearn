from fastapi import Cookie, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import utc_now
from app.db.models import AnonymousPlayer
from app.db.session import get_db
from app.services.names import generate_unique_display_name

COOKIE_NAME = "anon_player_id"


def set_player_cookie(response: Response, player_id: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=COOKIE_NAME,
        value=player_id,
        max_age=settings.cookie_max_age_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
    )


def get_or_create_player(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AnonymousPlayer:
    player_id = request.cookies.get(COOKIE_NAME)
    if player_id:
        player = db.get(AnonymousPlayer, player_id)
        if player:
            player.last_seen_at = utc_now()
            db.commit()
            return player

    player = AnonymousPlayer(display_name=generate_unique_display_name(db))
    db.add(player)
    db.commit()
    db.refresh(player)
    set_player_cookie(response, player.id)
    return player


def require_player(
    anon_player_id: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> AnonymousPlayer:
    if not anon_player_id:
        raise HTTPException(status_code=401, detail="Anonymous player not initialized")
    player = db.get(AnonymousPlayer, anon_player_id)
    if not player:
        raise HTTPException(status_code=401, detail="Unknown anonymous player")
    player.last_seen_at = utc_now()
    db.commit()
    return player
