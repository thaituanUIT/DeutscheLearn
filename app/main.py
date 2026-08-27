import mimetypes
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.config import get_settings
from app.db.models import Base
from app.db.session import SessionLocal, engine
from app.services.focus import import_focus_words
from app.services.story import import_story_passages
from app.services.words import seed_words

PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = PROJECT_ROOT / "frontend"
FRONTEND_DIST_DIR = FRONTEND_DIR / "dist"

mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/javascript", ".js")


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

    assets = FRONTEND_DIST_DIR / "assets"
    if settings.static_assets_enabled:
        if settings.environment == "production" and not assets.exists():
            raise RuntimeError("Production static assets are missing. Run `npm run build --prefix frontend`.")
        if assets.exists():
            api.mount("/assets", StaticFiles(directory=assets), name="assets")

    @api.get("/assets/{path:path}", include_in_schema=False)
    def missing_asset(path: str) -> None:
        raise HTTPException(status_code=404, detail=f"Asset not found: {path}")

    @api.get("/{path:path}", include_in_schema=False)
    def serve_spa(path: str) -> FileResponse:
        index = FRONTEND_DIST_DIR / "index.html"
        if index.exists():
            return FileResponse(index, headers={"Cache-Control": "no-store"})
        return FileResponse(FRONTEND_DIR / "index.html", headers={"Cache-Control": "no-store"})

    return api


app = create_app()
