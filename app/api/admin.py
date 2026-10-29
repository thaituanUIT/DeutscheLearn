import json
import logging
from secrets import compare_digest
from urllib import request as urlrequest
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.stimuli import exercise_type_for_passage, stimulus_image_url
from app.core.config import get_settings
from app.core.time import utc_now
from app.db.models import (
    CachedWord,
    FocusWordEntry,
    ReadingAnswer,
    ReadingPassage,
    ReadingQuestion,
    Topic,
    Upload,
)
from app.db.session import get_db
from app.schemas import (
    AdminFocusEntryOut,
    AdminImportPayload,
    AdminImportResult,
    AdminImportRowError,
    AdminReadingAdOut,
    AdminReadingAnswerOut,
    AdminReadingPassageIn,
    AdminReadingPassageOut,
    AdminReadingPassageSummaryOut,
    AdminReadingQuestionOut,
    AdminWordIn,
    AdminWordOut,
    AdminWordPatchIn,
    StimulusImageUploadUrlIn,
    StimulusImageUploadUrlOut,
)
from app.services.focus import (
    TOPIC_LABELS,
)
from app.services.goethe_reading import stimulus_kind_for, uses_source_choice

router = APIRouter(tags=["admin"])
logger = logging.getLogger(__name__)


class _AdAnswerPayload:
    def __init__(self, *, order_index: int, answer_text: str, is_correct: bool) -> None:
        self.order_index = order_index
        self.answer_text = answer_text
        self.is_correct = is_correct


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


@router.get(
    "/admin/reading/passages",
    response_model=list[AdminReadingPassageSummaryOut],
    dependencies=[Depends(require_admin)],
)
def admin_reading_passages(
    group: str | None = Query(default=None, pattern="^(general|goethe)$"),
    level: str | None = Query(default=None, pattern="^(A1|A2|B1|B2)$"),
    db: Session = Depends(get_db),
) -> list[AdminReadingPassageSummaryOut]:
    question_counts = (
        select(ReadingQuestion.stimulus_id, func.count(ReadingQuestion.id).label("question_count"))
        .group_by(ReadingQuestion.stimulus_id)
        .subquery()
    )
    query = (
        select(ReadingPassage, func.coalesce(question_counts.c.question_count, 0))
        .outerjoin(question_counts, question_counts.c.stimulus_id == ReadingPassage.id)
        .where(ReadingPassage.kind != "ad")
        .order_by(
            ReadingPassage.status,
            ReadingPassage.level,
            ReadingPassage.sort_order,
            ReadingPassage.title,
        )
    )
    if group:
        query = query.where(ReadingPassage.collection == group)
    if level:
        query = query.where(ReadingPassage.level == level)
    rows = db.execute(query).all()
    return [
        AdminReadingPassageSummaryOut(
            id=passage.id,
            group=passage.group,
            level=passage.level,
            part=passage.part,
            exercise_type=exercise_type_for_passage(passage),
            topic=passage.topic,
            title=passage.title,
            status=passage.status,
            order_index=passage.order_index,
            question_count=question_count,
        )
        for passage, question_count in rows
    ]


@router.post(
    "/admin/reading/passages",
    response_model=AdminReadingPassageOut,
    dependencies=[Depends(require_admin)],
)
def admin_create_reading_passage(
    payload: AdminReadingPassageIn,
    db: Session = Depends(get_db),
) -> AdminReadingPassageOut:
    kwargs = {"id": payload.id} if payload.id else {}
    passage = ReadingPassage(**kwargs)
    db.add(passage)
    _apply_reading_payload(passage, payload)
    _claim_stimulus_uploads(db, passage)
    db.commit()
    return _admin_reading_passage_out(passage)


@router.get(
    "/admin/reading/passages/{passage_id}",
    response_model=AdminReadingPassageOut,
    dependencies=[Depends(require_admin)],
)
def admin_reading_passage(passage_id: str, db: Session = Depends(get_db)) -> AdminReadingPassageOut:
    passage = _get_reading_passage(db, passage_id)
    return _admin_reading_passage_out(passage)


@router.patch(
    "/admin/reading/passages/{passage_id}",
    response_model=AdminReadingPassageOut,
    dependencies=[Depends(require_admin)],
)
def admin_update_reading_passage(
    passage_id: str,
    payload: AdminReadingPassageIn,
    db: Session = Depends(get_db),
) -> AdminReadingPassageOut:
    passage = _get_reading_passage(db, passage_id)
    _apply_reading_payload(passage, payload)
    _claim_stimulus_uploads(db, passage)
    db.commit()
    return _admin_reading_passage_out(passage)


@router.delete(
    "/admin/reading/passages/{passage_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
def admin_delete_reading_passage(passage_id: str, db: Session = Depends(get_db)) -> None:
    passage = _get_reading_passage(db, passage_id)
    _mark_stimulus_uploads_for_delete(db, passage)
    db.delete(passage)
    db.commit()


@router.post(
    "/admin/import/reading/preview",
    response_model=AdminImportResult,
    dependencies=[Depends(require_admin)],
)
def admin_preview_reading_import(
    payload: AdminImportPayload,
    db: Session = Depends(get_db),
) -> AdminImportResult:
    return _import_reading_passages(db, payload.items, commit=False)


@router.post(
    "/admin/import/reading",
    response_model=AdminImportResult,
    dependencies=[Depends(require_admin)],
)
def admin_import_reading(
    payload: AdminImportPayload,
    db: Session = Depends(get_db),
) -> AdminImportResult:
    return _import_reading_passages(db, payload.items, commit=True)


@router.post(
    "/stimuli/{stimulus_id}/image-upload-url",
    response_model=StimulusImageUploadUrlOut,
    dependencies=[Depends(require_admin)],
)
def create_stimulus_image_upload_url(
    stimulus_id: str,
    payload: StimulusImageUploadUrlIn,
    db: Session = Depends(get_db),
) -> StimulusImageUploadUrlOut:
    path = f"stimuli/{stimulus_id}/{uuid4()}.{_image_extension(payload.content_type)}"
    token = _create_supabase_signed_upload_token(path)
    settings = get_settings()
    upload_url = (
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/upload/sign/stimuli/{path}"
        f"?token={token}"
        if settings.supabase_url
        else ""
    )
    db.add(Upload(path=path))
    db.commit()
    return StimulusImageUploadUrlOut(
        bucket="stimuli", path=path, token=token, upload_url=upload_url
    )


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


def _import_reading_passages(db: Session, rows: list[dict], *, commit: bool) -> AdminImportResult:
    valid_rows: list[tuple[int, AdminReadingPassageIn]] = []
    errors: list[AdminImportRowError] = []
    seen_ids: set[str] = set()

    for row_number, row in enumerate(rows, start=1):
        try:
            passage = AdminReadingPassageIn.model_validate(row)
            if passage.id:
                if passage.id in seen_ids:
                    errors.append(
                        _import_error(row_number, "id", "Duplicate passage id in import file.")
                    )
                    continue
                seen_ids.add(passage.id)
            valid_rows.append((row_number, passage))
        except ValidationError as exc:
            errors.extend(_validation_errors(row_number, exc))

    created, updated = _reading_import_counts(db, [passage for _, passage in valid_rows])
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
        passage = (
            db.scalar(select(ReadingPassage).where(ReadingPassage.id == payload.id))
            if payload.id
            else None
        )
        if passage is None:
            kwargs = {"id": payload.id} if payload.id else {}
            passage = ReadingPassage(**kwargs)
            db.add(passage)
        _apply_reading_payload(passage, payload)
        _claim_stimulus_uploads(db, passage)
    db.commit()
    return result


def _reading_import_counts(db: Session, rows: list[AdminReadingPassageIn]) -> tuple[int, int]:
    ids = [row.id for row in rows if row.id]
    existing = (
        set(db.scalars(select(ReadingPassage.id).where(ReadingPassage.id.in_(ids))).all())
        if ids
        else set()
    )
    updated = sum(1 for row in rows if row.id in existing)
    return (len(rows) - updated, updated)


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


def _get_reading_passage(db: Session, passage_id: str) -> ReadingPassage:
    passage = db.scalar(
        select(ReadingPassage)
        .options(
            selectinload(ReadingPassage.items)
            .selectinload(ReadingQuestion.options)
            .selectinload(ReadingAnswer.ref_stimulus)
        )
        .where(ReadingPassage.id == passage_id)
    )
    if passage is None:
        raise HTTPException(status_code=404, detail="Reading passage not found")
    return passage


def _apply_reading_payload(passage: ReadingPassage, payload: AdminReadingPassageIn) -> None:
    passage.collection = payload.group
    passage.level = payload.level
    passage.teil = payload.part if payload.group == "goethe" else None
    passage.kind = _stimulus_kind(payload.group, payload.level, payload.part)
    passage.title = payload.title.strip()
    passage.body = payload.passage_text.strip()
    passage.image_url = _clean_optional_text(payload.image_url)
    passage.render_kind = payload.render_kind
    passage.content = payload.content
    passage.image_path = _clean_optional_text(payload.image_path)
    passage.transcript = _clean_optional_text(payload.transcript)
    passage.status = payload.status
    passage.context_label = _clean_optional_text(payload.context_label)
    passage.sort_order = payload.order_index
    passage.updated_at = utc_now()
    ad_rows = (
        _reading_ad_stimuli_from_payload(payload)
        if uses_source_choice(payload.group, payload.level, payload.part)
        else []
    )
    passage.items = [
        _reading_item_from_payload(question, ad_rows if index == 0 else [])
        for index, question in enumerate(payload.questions)
    ]


def _admin_reading_passage_out(passage: ReadingPassage) -> AdminReadingPassageOut:
    ad_stimuli = _admin_ad_stimuli_out(passage)
    return AdminReadingPassageOut(
        id=passage.id,
        group=passage.group,
        level=passage.level,
        part=passage.part,
        exercise_type=exercise_type_for_passage(passage),
        topic=passage.topic,
        title=passage.title,
        passage_text=passage.passage_text,
        image_url=stimulus_image_url(passage),
        render_kind=passage.render_kind,
        content=passage.content,
        image_path=passage.image_path,
        transcript=passage.transcript,
        context_label=passage.context_label,
        status=passage.status,
        order_index=passage.order_index,
        ad_stimuli=ad_stimuli,
        questions=[
            AdminReadingQuestionOut(
                id=question.id,
                prompt=question.prompt,
                explanation=question.explanation,
                order_index=question.order_index,
                answers=[
                    AdminReadingAnswerOut(
                        id=answer.id,
                        answer_text=answer.answer_text,
                        is_correct=answer.is_correct,
                        order_index=answer.order_index,
                    )
                    for answer in question.answers
                ],
            )
            for question in passage.questions
        ],
    )


def _reading_item_from_payload(
    question, ad_rows: list[ReadingPassage] | None = None
) -> ReadingQuestion:
    item = ReadingQuestion(
        prompt=question.prompt.strip(),
        explanation=_clean_optional_text(question.explanation),
        answer_type="choice"
        if ad_rows
        else ("true_false" if _is_true_false_answers(question.answers) else "choice"),
        sort_order=question.order_index,
    )
    correct_option = None
    answer_rows = question.answers
    if ad_rows:
        answer_rows = [
            _AdAnswerPayload(order_index=index, answer_text=ad.title, is_correct=False)
            for index, ad in enumerate(ad_rows)
        ]
        correct_index = next(
            (
                answer.order_index
                for answer in question.answers
                if answer.is_correct and 0 <= answer.order_index < len(answer_rows)
            ),
            0,
        )
        answer_rows[correct_index].is_correct = True
    for index, answer in enumerate(answer_rows):
        option = ReadingAnswer(
            key=str(answer.order_index),
            label=answer.answer_text.strip(),
            sort_order=answer.order_index,
            ref_stimulus=ad_rows[index] if ad_rows and index < len(ad_rows) else None,
        )
        item.options.append(option)
        if answer.is_correct:
            correct_option = option
    item.correct_option = correct_option
    return item


def _reading_ad_stimuli_from_payload(payload: AdminReadingPassageIn) -> list[ReadingPassage]:
    ads = sorted(payload.ad_stimuli, key=lambda ad: ad.order_index)
    rows: list[ReadingPassage] = []
    for index, ad in enumerate(ads[:2]):
        kwargs = {"id": ad.id} if ad.id else {}
        rows.append(
            ReadingPassage(
                **kwargs,
                collection="goethe",
                level=payload.level,
                teil=payload.part,
                kind="ad",
                title=f"{ad.key}) {ad.title.strip()}",
                body=ad.body.strip(),
                render_kind=ad.render_kind,
                content=ad.content,
                image_path=_clean_optional_text(ad.image_path),
                transcript=_clean_optional_text(ad.transcript),
                status="published",
                context_label=_clean_optional_text(ad.context_label),
                sort_order=index,
            )
        )
    return rows


def _admin_ad_stimuli_out(passage: ReadingPassage) -> list[AdminReadingAdOut]:
    ads: dict[str, ReadingPassage] = {}
    for question in passage.questions:
        for answer in question.answers:
            if answer.ref_stimulus is not None:
                ads[answer.ref_stimulus.id] = answer.ref_stimulus
    return [
        AdminReadingAdOut(
            id=ad.id,
            key="a" if index == 0 else "b",
            title=ad.title.removeprefix("a) ").removeprefix("b) "),
            body=ad.body,
            render_kind=ad.render_kind,
            content=ad.content,
            image_path=ad.image_path,
            transcript=ad.transcript,
            context_label=ad.context_label,
            order_index=index,
        )
        for index, ad in enumerate(sorted(ads.values(), key=lambda row: row.sort_order)[:2])
    ]


def _is_true_false_answers(answers) -> bool:
    labels = {answer.answer_text.casefold() for answer in answers}
    return labels <= {"richtig", "falsch", "true", "false"} and len(labels) == 2


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = " ".join(value.split())
    return text or None


def _stimulus_kind(group: str, level: str, part: str | None) -> str:
    return stimulus_kind_for(group, level, part)


def _image_extension(content_type: str) -> str:
    if content_type == "image/jpeg":
        return "jpg"
    if content_type == "image/png":
        return "png"
    return "webp"


def _create_supabase_signed_upload_token(path: str) -> str:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise HTTPException(status_code=503, detail="Supabase Storage is not configured")

    base_url = settings.supabase_url.rstrip("/")
    endpoint = f"{base_url}/storage/v1/object/upload/sign/stimuli/{path}"
    body = json.dumps({"upsert": False}).encode("utf-8")
    request = urlrequest.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "apikey": settings.supabase_service_role_key,
            "Content-Type": "application/json",
        },
    )
    try:
        with urlrequest.urlopen(request, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
    except OSError as error:
        raise HTTPException(status_code=502, detail="Could not create signed upload URL") from error
    token = data.get("token")
    if not isinstance(token, str) or not token:
        raise HTTPException(status_code=502, detail="Supabase did not return an upload token")
    return token


def _claim_stimulus_uploads(db: Session, passage: ReadingPassage) -> None:
    owners = _stimulus_image_owners(passage)
    if not owners:
        return
    uploads = db.scalars(select(Upload).where(Upload.path.in_(owners))).all()
    for upload in uploads:
        upload.stimulus_id = owners[upload.path]
        upload.delete_after_at = None


def _mark_stimulus_uploads_for_delete(db: Session, passage: ReadingPassage) -> None:
    paths = [path for path in _stimulus_image_paths(passage) if path]
    if not paths:
        return
    uploads = db.scalars(select(Upload).where(Upload.path.in_(paths))).all()
    for upload in uploads:
        upload.delete_after_at = utc_now()


def _stimulus_image_paths(passage: ReadingPassage) -> list[str | None]:
    return list(_stimulus_image_owners(passage))


def _stimulus_image_owners(passage: ReadingPassage) -> dict[str, str]:
    owners = {passage.image_path: passage.id} if passage.image_path else {}
    for question in passage.questions:
        for answer in question.answers:
            if answer.ref_stimulus is not None and answer.ref_stimulus.image_path:
                owners[answer.ref_stimulus.image_path] = answer.ref_stimulus.id
    return owners
