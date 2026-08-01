from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.config import get_settings
from app.db.models import Base
from app.db.session import SessionLocal, engine
from app.services.focus import import_focus_words
from app.services.story import import_story_passages
from app.services.words import seed_words


@asynccontextmanager
async def lifespan(api: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    Base.metadata.create_all(bind=engine)
    if settings.seed_on_startup:
        db = SessionLocal()
        try:
            seed_words(db)
            import_focus_words(db)
            import_story_passages(db)
        finally:
            db.close()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    api = FastAPI(title=settings.app_name, lifespan=lifespan)
    api.include_router(router)

    dist = Path("frontend/dist")
    assets = dist / "assets"
    if assets.exists():
        api.mount("/assets", StaticFiles(directory=assets), name="assets")

    @api.get("/{path:path}", include_in_schema=False)
    def serve_spa(path: str) -> FileResponse:
        index = dist / "index.html"
        if index.exists():
            return FileResponse(index, headers={"Cache-Control": "no-store"})
        return FileResponse("frontend/index.html", headers={"Cache-Control": "no-store"})

    return api


app = create_app()
