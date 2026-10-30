import logging
from secrets import compare_digest

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.db.models import (
    CachedWord,
    FocusWordEntry,
    Topic,
)
from app.db.session import get_db
from app.schemas import (
    AdminFocusEntryOut,
    AdminImportPayload,
    AdminImportResult,
    AdminImportRowError,
    AdminWordIn,
    AdminWordOut,
    AdminWordPatchIn,
)
from app.services.focus import (
    TOPIC_LABELS,
)

router = APIRouter(tags=["admin"])
logger = logging.getLogger(__name__)


def require_admin(authorization: str | None = Header(default=None)) -> None:
    settings = get_settings()
    if not settings.admin_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin access is not configured",
        )
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.casefold() != "bearer" or not compare_digest(token, settings.admin_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin token")


@router.get(
    "/admin/words",
    response_model=list[AdminWordOut],
    dependencies=[Depends(require_admin)],
)
def admin_words(
    search: str = Query(default="", max_length=120),
    level: str | None = Query(default=None, pattern="^(A1|A2|B1|B2)$"),
    topic: str | None = Query(default=None, max_length=80),
    db: Session = Depends(get_db),
) -> list[AdminWordOut]:
    query = select(CachedWord).options(
        selectinload(CachedWord.focus_entries).selectinload(FocusWordEntry.topic)
    )
    if search.strip():
        query = query.where(CachedWord.lemma.ilike(f"%{search.strip()}%"))
    if level or topic:
        query = query.join(FocusWordEntry)
        if level:
            query = query.where(FocusWordEntry.level == level)
        if topic:
            query = query.join(Topic).where(Topic.slug == topic)
    query = query.order_by(CachedWord.lemma).limit(200)
    words = db.scalars(query).unique().all()
    return [_admin_word_out(word) for word in words]


@router.post(
    "/admin/words",
    response_model=AdminWordOut,
    dependencies=[Depends(require_admin)],
)
def admin_create_word(payload: AdminWordIn, db: Session = Depends(get_db)) -> AdminWordOut:
    word_key = payload.word.strip()
    if db.scalar(select(CachedWord).where(CachedWord.lemma == word_key)) is not None:
        raise HTTPException(status_code=409, detail="Word already exists")
    _validate_focus_entries(payload.focus_entries)
    word = CachedWord(
        lemma=word_key,
        article=_clean_optional_text(payload.article),
        part_of_speech=payload.part_of_speech.strip(),
        meaning=payload.meaning.strip(),
    )
    db.add(word)
    db.flush()
    _replace_focus_entries(db, word_key, payload.focus_entries)
    db.commit()
    db.refresh(word)
    return _admin_word_out(word)


@router.patch(
    "/admin/words/{word_key}",
    response_model=AdminWordOut,
    dependencies=[Depends(require_admin)],
)
def admin_update_word(
    word_key: str,
    payload: AdminWordPatchIn,
    db: Session = Depends(get_db),
) -> AdminWordOut:
    word = db.scalar(select(CachedWord).where(CachedWord.lemma == word_key))
    if word is None:
        raise HTTPException(status_code=404, detail="Word not found")
    _validate_focus_entries(payload.focus_entries)
    word.article = _clean_optional_text(payload.article)
    word.part_of_speech = payload.part_of_speech.strip()
    word.meaning = payload.meaning.strip()
    _replace_focus_entries(db, word.word, payload.focus_entries)
    db.commit()
    db.refresh(word)
    return _admin_word_out(word)


@router.delete(
    "/admin/words/{word_key}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
def admin_delete_word(word_key: str, db: Session = Depends(get_db)) -> None:
    word = db.scalar(select(CachedWord).where(CachedWord.lemma == word_key))
    if word is None:
        raise HTTPException(status_code=404, detail="Word not found")
    for entry in list(word.focus_entries):
        db.delete(entry)
    db.delete(word)
    db.commit()


@router.post(
    "/admin/import/words/preview",
    response_model=AdminImportResult,
    dependencies=[Depends(require_admin)],
)
def admin_preview_word_import(
    payload: AdminImportPayload,
    db: Session = Depends(get_db),
) -> AdminImportResult:
    return _import_words(db, payload.items, commit=False)


@router.post(
    "/admin/import/words",
    response_model=AdminImportResult,
    dependencies=[Depends(require_admin)],
)
def admin_import_words(
    payload: AdminImportPayload,
    db: Session = Depends(get_db),
) -> AdminImportResult:
    return _import_words(db, payload.items, commit=True)


def _admin_word_out(word: CachedWord) -> AdminWordOut:
    return AdminWordOut(
        word=word.word,
        article=word.article,
        part_of_speech=word.part_of_speech,
        meaning=word.meaning,
        focus_entries=[
            AdminFocusEntryOut(id=entry.id, level=entry.level, topic=entry.topic.slug)
            for entry in sorted(word.focus_entries, key=lambda item: (item.level, item.topic.slug))
        ],
    )


def _import_words(db: Session, rows: list[dict], *, commit: bool) -> AdminImportResult:
    valid_rows: list[tuple[int, AdminWordIn]] = []
    errors: list[AdminImportRowError] = []
    seen_words: set[str] = set()

    for row_number, row in enumerate(rows, start=1):
        try:
            word = AdminWordIn.model_validate(row)
            word_key = word.word.strip()
            if word_key in seen_words:
                errors.append(_import_error(row_number, "word", "Duplicate word in import file."))
                continue
            seen_words.add(word_key)
            _validate_word_import_rules(word, row_number, errors)
            _validate_focus_entries(word.focus_entries)
            if not any(error.row == row_number for error in errors):
                valid_rows.append((row_number, word))
        except ValidationError as exc:
            errors.extend(_validation_errors(row_number, exc))
        except HTTPException as exc:
            errors.append(_import_error(row_number, "focus_entries", str(exc.detail)))

    created, updated = _word_import_counts(db, [word for _, word in valid_rows])
    result = AdminImportResult(
        total=len(rows),
        valid=len(valid_rows),
        created=created,
        updated=updated,
        skipped=_skipped_row_count(errors),
        errors=errors,
    )
    if errors or not commit:
        return result

    for _, payload in valid_rows:
        word_key = payload.word.strip()
        word = db.scalar(select(CachedWord).where(CachedWord.lemma == word_key))
        if word is None:
            word = CachedWord(
                lemma=word_key,
                article=_clean_optional_text(payload.article),
                part_of_speech=payload.part_of_speech.strip(),
                meaning=payload.meaning.strip(),
            )
            db.add(word)
            db.flush()
        else:
            word.article = _clean_optional_text(payload.article)
            word.part_of_speech = payload.part_of_speech.strip()
            word.meaning = payload.meaning.strip()
        _replace_focus_entries(db, word_key, payload.focus_entries)
    db.commit()
    return result


def _word_import_counts(db: Session, rows: list[AdminWordIn]) -> tuple[int, int]:
    if not rows:
        return (0, 0)
    word_keys = [row.word.strip() for row in rows]
    existing = set(
        db.scalars(select(CachedWord.lemma).where(CachedWord.lemma.in_(word_keys))).all()
    )
    updated = sum(1 for key in word_keys if key in existing)
    return (len(word_keys) - updated, updated)


def _validate_word_import_rules(
    word: AdminWordIn,
    row_number: int,
    errors: list[AdminImportRowError],
) -> None:
    article = _clean_optional_text(word.article)
    part_of_speech = word.part_of_speech.strip()
    if article and article not in {"der", "die", "das"}:
        errors.append(
            _import_error(row_number, "article", "Article must be der, die, das, or empty.")
        )
    if article and part_of_speech != "noun":
        errors.append(_import_error(row_number, "article", "Only nouns can have an article."))


def _validation_errors(row_number: int, exc: ValidationError) -> list[AdminImportRowError]:
    return [
        _import_error(
            row_number,
            _validation_field(error.get("loc", ())),
            str(error.get("msg", "Invalid value.")),
        )
        for error in exc.errors()
    ]


def _validation_field(loc: tuple | list) -> str:
    if not loc:
        return "__root__"
    return ".".join(str(part) for part in loc)


def _import_error(row_number: int, field: str, message: str) -> AdminImportRowError:
    return AdminImportRowError(row=row_number, field=field, message=message)


def _skipped_row_count(errors: list[AdminImportRowError]) -> int:
    return len({error.row for error in errors})


def _replace_focus_entries(
    db: Session,
    word: str,
    entries: list,
) -> None:
    word_row = db.scalar(select(CachedWord).where(CachedWord.lemma == word))
    if word_row is None:
        return
    existing = db.scalars(select(FocusWordEntry).where(FocusWordEntry.word_id == word_row.id)).all()
    for entry in existing:
        db.delete(entry)
    db.flush()

    seen = set()
    for entry in entries:
        key = (entry.level, entry.topic.strip())
        if key in seen:
            continue
        seen.add(key)
        topic = _get_or_create_topic(db, key[1])
        db.add(FocusWordEntry(word_id=word_row.id, level=entry.level, topic_id=topic.id))


def _validate_focus_entries(entries: list) -> None:
    valid_topics = set(TOPIC_LABELS)
    invalid_topics = sorted(
        {entry.topic.strip() for entry in entries if entry.topic.strip() not in valid_topics}
    )
    if invalid_topics:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown focus topic: {', '.join(invalid_topics)}",
        )


def _get_or_create_topic(db: Session, slug: str) -> Topic:
    topic = db.scalar(select(Topic).where(Topic.slug == slug))
    if topic is not None:
        return topic
    topic = Topic(
        slug=slug,
        name=TOPIC_LABELS.get(slug, " ".join(piece.capitalize() for piece in slug.split("_"))),
    )
    db.add(topic)
    db.flush()
    return topic


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = " ".join(value.split())
    return text or None
