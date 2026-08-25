import json
from secrets import compare_digest
from urllib import request as urlrequest
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_or_create_player, require_player
from app.core.config import get_settings
from app.core.time import utc_now
from app.db.models import (
    AnonymousPlayer,
    CachedWord,
    FocusWordEntry,
    QuizAttempt,
    QuizAttemptQuestion,
    ReadingAnswer,
    ReadingPassage,
    ReadingQuestion,
    Topic,
    Upload,
)
from app.db.session import get_db
from app.schemas import (
    AdminFocusEntryOut,
    AdminReadingAdOut,
    AdminReadingAnswerOut,
    AdminReadingPassageIn,
    AdminReadingPassageOut,
    AdminReadingPassageSummaryOut,
    AdminReadingQuestionOut,
    AdminWordIn,
    AdminWordOut,
    AdminWordPatchIn,
    EndlessAnswerIn,
    EndlessAnswerOut,
    EndlessStartOut,
    FocusCardOut,
    FocusLevelOut,
    FocusRevisionQuestionOut,
    FocusTopicAliasOut,
    FocusTopicOut,
    GrammarAskIn,
    GrammarAskOut,
    GrammarCitationOut,
    LeaderboardEntry,
    PlayerOut,
    PracticeAnswerOut,
    PracticeStartOut,
    StimulusImageUploadUrlIn,
    StimulusImageUploadUrlOut,
    StoryAnswerChoiceOut,
    StoryAnswerIn,
    StoryAnswerOut,
    StoryGroupOut,
    StoryLevelOut,
    StoryOptionStimulusOut,
    StoryPartOut,
    StoryPassageOut,
    StoryPassageSummaryOut,
    StoryQuestionOut,
    TimedAnswerOut,
    TimedStartOut,
    WordOfDayOut,
)
from app.services.focus import (
    TOPIC_LABELS,
    get_focus_cards,
    get_focus_levels,
    get_focus_revision_questions,
    get_focus_topics,
)
from app.services.grammar import (
    GrammarServiceError,
    GrammarUnavailableError,
    answer_grammar_question,
    check_rate_limit,
)
from app.services.quiz import create_question
from app.services.story import (
    get_correct_story_answer,
    get_goethe_parts,
    get_story_answer,
    get_story_groups,
    get_story_levels,
    get_story_passage,
    get_story_passages,
)
from app.services.words import get_meaning_overview, get_word_of_day

router = APIRouter(prefix="/api")
TIMED_DURATION_SECONDS = 60


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


def _has_admin_bearer(authorization: str | None) -> bool:
    settings = get_settings()
    if not settings.admin_token:
        return False
    scheme, _, token = (authorization or "").partition(" ")
    return scheme.casefold() == "bearer" and compare_digest(token, settings.admin_token)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/grammar/ask", response_model=GrammarAskOut)
def grammar_ask(
    payload: GrammarAskIn,
    request: Request,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> GrammarAskOut:
    include_debug = payload.include_debug and _has_admin_bearer(authorization)
    client_ip = request.client.host if request.client else "unknown"
    try:
        check_rate_limit(payload.learner_id, client_ip)
        result = answer_grammar_question(
            db=db,
            question=payload.question.strip(),
            include_debug=include_debug,
        )
    except PermissionError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="You've asked a lot of questions. Try again in a few minutes.",
        ) from None
    except GrammarUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The grammar assistant is unavailable right now.",
        ) from exc
    except GrammarServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Something went wrong while answering.",
        ) from exc
    return GrammarAskOut(
        status=result.status,
        answer=result.answer,
        citations=[
            GrammarCitationOut(
                chunk_id=citation.chunk_id,
                title=citation.title,
                section=citation.section,
                content=citation.content,
                level=citation.level,
                topic=citation.topic,
                similarity=citation.similarity,
                source_path=citation.source_path,
                source_kind=citation.source_kind,
                page_start=citation.page_start,
                page_end=citation.page_end,
            )
            for citation in result.citations
        ],
        retrieval_debug=result.retrieval_debug,
        cached=result.cached,
    )


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


@router.get("/focus/levels", response_model=list[FocusLevelOut])
def focus_levels(db: Session = Depends(get_db)) -> list[FocusLevelOut]:
    return [FocusLevelOut(**level) for level in get_focus_levels(db)]


@router.get("/focus/topics", response_model=list[FocusTopicOut])
def focus_topics(
    level: str = Query(pattern="^(A1|A2|B1|B2)$"),
    db: Session = Depends(get_db),
) -> list[FocusTopicOut]:
    return [FocusTopicOut(**topic) for topic in get_focus_topics(db, level)]


@router.get("/focus/topic-aliases", response_model=list[FocusTopicAliasOut])
def focus_topic_aliases() -> list[FocusTopicAliasOut]:
    return [
        FocusTopicAliasOut(topic=topic, label=label)
        for topic, label in sorted(TOPIC_LABELS.items())
    ]


@router.get("/focus/cards", response_model=list[FocusCardOut])
def focus_cards(
    level: str = Query(pattern="^(A1|A2|B1|B2)$"),
    topic: str = Query(min_length=1, max_length=80),
    db: Session = Depends(get_db),
) -> list[FocusCardOut]:
    return [FocusCardOut(**card) for card in get_focus_cards(db, level, topic)]


@router.get("/focus/revision", response_model=list[FocusRevisionQuestionOut])
def focus_revision(
    level: str = Query(pattern="^(A1|A2|B1|B2)$"),
    topic: str = Query(min_length=1, max_length=80),
    db: Session = Depends(get_db),
) -> list[FocusRevisionQuestionOut]:
    return [
        FocusRevisionQuestionOut(**question)
        for question in get_focus_revision_questions(db, level, topic)
    ]


@router.get("/story/groups", response_model=list[StoryGroupOut])
def story_groups(db: Session = Depends(get_db)) -> list[StoryGroupOut]:
    return [StoryGroupOut(**group) for group in get_story_groups(db)]


@router.get("/story/levels", response_model=list[StoryLevelOut])
def story_levels(
    group: str = Query(default="general", pattern="^(general|goethe)$"),
    db: Session = Depends(get_db),
) -> list[StoryLevelOut]:
    return [StoryLevelOut(**level) for level in get_story_levels(db, group)]


@router.get("/story/parts", response_model=list[StoryPartOut])
def story_parts(
    level: str = Query(pattern="^(A1|A2|B1|B2)$"),
    db: Session = Depends(get_db),
) -> list[StoryPartOut]:
    return [StoryPartOut(**part) for part in get_goethe_parts(db, level)]


@router.get("/story/passages", response_model=list[StoryPassageSummaryOut])
def story_passages(
    group: str = Query(default="general", pattern="^(general|goethe)$"),
    level: str = Query(pattern="^(A1|A2|B1|B2)$"),
    part: str | None = Query(default=None, pattern="^teil_[1-5]$"),
    db: Session = Depends(get_db),
) -> list[StoryPassageSummaryOut]:
    return [
        StoryPassageSummaryOut(**passage)
        for passage in get_story_passages(db, level, group, part)
    ]


@router.get("/story/passages/{passage_id}", response_model=StoryPassageOut)
def story_passage(passage_id: str, db: Session = Depends(get_db)) -> StoryPassageOut:
    passage = get_story_passage(db, passage_id)
    if passage is None:
        raise HTTPException(status_code=404, detail="Story passage not found")
    return _story_passage_out(passage)


@router.post("/story/answer", response_model=StoryAnswerOut)
def story_answer(payload: StoryAnswerIn, db: Session = Depends(get_db)) -> StoryAnswerOut:
    selected = get_story_answer(db, payload.question_id, payload.answer_id)
    if selected is None:
        raise HTTPException(status_code=404, detail="Story answer not found")
    correct = get_correct_story_answer(db, payload.question_id)
    if correct is None:
        raise HTTPException(status_code=409, detail="Story question has no correct answer")
    return StoryAnswerOut(
        correct=selected.id == correct.id,
        correct_answer_id=correct.id,
        correct_answer_text=correct.answer_text,
        explanation=selected.question.explanation,
    )


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
        .order_by(ReadingPassage.status, ReadingPassage.level, ReadingPassage.sort_order, ReadingPassage.title)
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
            exercise_type=_exercise_type(passage),
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
    return StimulusImageUploadUrlOut(bucket="stimuli", path=path, token=token, upload_url=upload_url)


@router.post("/quiz/endless/start", response_model=EndlessStartOut)
def start_endless(
    player: AnonymousPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> EndlessStartOut:
    attempt = QuizAttempt(player_id=player.id, mode="endless")
    db.add(attempt)
    db.flush()
    question = create_question(db, attempt)
    db.commit()
    return EndlessStartOut(attempt_id=attempt.id, score=attempt.score, question=question)


@router.post("/quiz/practice/start", response_model=PracticeStartOut)
def start_practice(
    player: AnonymousPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> PracticeStartOut:
    attempt = QuizAttempt(player_id=player.id, mode="practice")
    db.add(attempt)
    db.flush()
    question = create_question(db, attempt)
    db.commit()
    return PracticeStartOut(
        attempt_id=attempt.id,
        score=attempt.score,
        total_questions=attempt.total_questions,
        question=question,
    )


@router.post("/quiz/timed/start", response_model=TimedStartOut)
def start_timed(
    player: AnonymousPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> TimedStartOut:
    attempt = QuizAttempt(player_id=player.id, mode="timed")
    db.add(attempt)
    db.flush()
    question = create_question(db, attempt)
    db.commit()
    return TimedStartOut(
        attempt_id=attempt.id,
        score=attempt.score,
        total_questions=attempt.total_questions,
        duration_seconds=TIMED_DURATION_SECONDS,
        question=question,
    )


@router.post("/quiz/endless/answer", response_model=EndlessAnswerOut)
def answer_endless(
    payload: EndlessAnswerIn,
    player: AnonymousPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> EndlessAnswerOut:
    attempt = db.get(QuizAttempt, payload.attempt_id)
    if not attempt or attempt.player_id != player.id or attempt.mode != "endless":
        raise HTTPException(status_code=404, detail="Attempt not found")
    if attempt.status != "active":
        raise HTTPException(status_code=409, detail="Attempt already finished")

    question = db.get(QuizAttemptQuestion, payload.question_id)
    if not question or question.attempt_id != attempt.id:
        raise HTTPException(status_code=404, detail="Question not found")
    if question.answered_at is not None:
        raise HTTPException(status_code=409, detail="Question already answered")

    selected = payload.selected_answer.strip()
    if selected not in json.loads(question.choices_json):
        raise HTTPException(status_code=422, detail="Selected answer is not a valid choice")

    correct = selected.casefold() == question.correct_answer.casefold()
    question.selected_answer = selected
    question.is_correct = correct
    question.answered_at = utc_now()
    attempt.total_questions += 1

    next_question = None
    if correct:
        attempt.score += 1
        next_question = create_question(db, attempt)
    else:
        attempt.status = "finished"
        attempt.ended_at = utc_now()
        attempt.ended_reason = "wrong_answer"
        attempt.accuracy = attempt.score / attempt.total_questions if attempt.total_questions else 0
        player.total_games_played += 1
        player.best_endless_score = max(player.best_endless_score, attempt.score)

    db.commit()
    return EndlessAnswerOut(
        correct=correct,
        score=attempt.score,
        correct_answer=question.correct_answer,
        answered_word=question.word,
        meaning_overview=get_meaning_overview(db, question.word),
        attempt_finished=not correct,
        next_question=next_question,
    )


@router.post("/quiz/practice/answer", response_model=PracticeAnswerOut)
def answer_practice(
    payload: EndlessAnswerIn,
    player: AnonymousPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> PracticeAnswerOut:
    attempt = db.get(QuizAttempt, payload.attempt_id)
    if not attempt or attempt.player_id != player.id or attempt.mode != "practice":
        raise HTTPException(status_code=404, detail="Attempt not found")
    if attempt.status != "active":
        raise HTTPException(status_code=409, detail="Attempt already finished")

    question = db.get(QuizAttemptQuestion, payload.question_id)
    if not question or question.attempt_id != attempt.id:
        raise HTTPException(status_code=404, detail="Question not found")
    if question.answered_at is not None:
        raise HTTPException(status_code=409, detail="Question already answered")

    selected = payload.selected_answer.strip()
    if selected not in json.loads(question.choices_json):
        raise HTTPException(status_code=422, detail="Selected answer is not a valid choice")

    correct = selected.casefold() == question.correct_answer.casefold()
    question.selected_answer = selected
    question.is_correct = correct
    question.answered_at = utc_now()
    attempt.total_questions += 1
    if correct:
        attempt.score += 1
    attempt.accuracy = attempt.score / attempt.total_questions if attempt.total_questions else 0
    next_question = create_question(db, attempt)

    db.commit()
    return PracticeAnswerOut(
        correct=correct,
        score=attempt.score,
        total_questions=attempt.total_questions,
        correct_answer=question.correct_answer,
        next_question=next_question,
    )


@router.post("/quiz/timed/answer", response_model=TimedAnswerOut)
def answer_timed(
    payload: EndlessAnswerIn,
    player: AnonymousPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> TimedAnswerOut:
    now = utc_now()
    attempt = db.get(QuizAttempt, payload.attempt_id)
    if not attempt or attempt.player_id != player.id or attempt.mode != "timed":
        raise HTTPException(status_code=404, detail="Attempt not found")
    if attempt.status != "active":
        raise HTTPException(status_code=409, detail="Attempt already finished")

    elapsed_seconds = int((now - attempt.started_at).total_seconds())
    if elapsed_seconds >= TIMED_DURATION_SECONDS:
        attempt.status = "finished"
        attempt.ended_at = now
        attempt.ended_reason = "time_expired"
        attempt.accuracy = attempt.score / attempt.total_questions if attempt.total_questions else 0
        player.total_games_played += 1
        db.commit()
        return TimedAnswerOut(
            correct=False,
            score=attempt.score,
            total_questions=attempt.total_questions,
            correct_answer="",
            attempt_finished=True,
            seconds_remaining=0,
            next_question=None,
        )

    question = db.get(QuizAttemptQuestion, payload.question_id)
    if not question or question.attempt_id != attempt.id:
        raise HTTPException(status_code=404, detail="Question not found")
    if question.answered_at is not None:
        raise HTTPException(status_code=409, detail="Question already answered")

    selected = payload.selected_answer.strip()
    if selected not in json.loads(question.choices_json):
        raise HTTPException(status_code=422, detail="Selected answer is not a valid choice")

    correct = selected.casefold() == question.correct_answer.casefold()
    question.selected_answer = selected
    question.is_correct = correct
    question.answered_at = now
    attempt.total_questions += 1
    if correct:
        attempt.score += 1
    attempt.accuracy = attempt.score / attempt.total_questions if attempt.total_questions else 0

    seconds_remaining = max(0, TIMED_DURATION_SECONDS - elapsed_seconds)
    next_question = create_question(db, attempt) if seconds_remaining > 0 else None
    if next_question is None:
        attempt.status = "finished"
        attempt.ended_at = now
        attempt.ended_reason = "time_expired"
        player.total_games_played += 1

    db.commit()
    return TimedAnswerOut(
        correct=correct,
        score=attempt.score,
        total_questions=attempt.total_questions,
        correct_answer=question.correct_answer,
        attempt_finished=next_question is None,
        seconds_remaining=seconds_remaining,
        next_question=next_question,
    )


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
def leaderboard(
    mode: str = Query(default="endless", pattern="^(endless|timed)$"),
    limit: int = Query(default=20, ge=1, le=100),
    player: AnonymousPlayer = Depends(get_or_create_player),
    db: Session = Depends(get_db),
) -> list[LeaderboardEntry]:
    player_best_attempts = (
        select(
            QuizAttempt.id.label("attempt_id"),
            func.row_number()
            .over(
                partition_by=QuizAttempt.player_id,
                order_by=(
                    QuizAttempt.score.desc(),
                    QuizAttempt.accuracy.desc(),
                    QuizAttempt.ended_at.asc(),
                ),
            )
            .label("player_rank"),
        )
        .where(QuizAttempt.mode == mode, QuizAttempt.status == "finished")
        .where(QuizAttempt.score > 0)
        .subquery()
    )
    ranked = (
        select(
            player_best_attempts.c.attempt_id,
            func.row_number()
            .over(
                order_by=(
                    QuizAttempt.score.desc(),
                    QuizAttempt.accuracy.desc(),
                    QuizAttempt.ended_at.asc(),
                )
            )
            .label("rank"),
        )
        .join(QuizAttempt, QuizAttempt.id == player_best_attempts.c.attempt_id)
        .where(player_best_attempts.c.player_rank == 1)
        .subquery()
    )

    attempts = db.execute(
        select(QuizAttempt, AnonymousPlayer.display_name, ranked.c.rank)
        .join(ranked, ranked.c.attempt_id == QuizAttempt.id)
        .join(AnonymousPlayer, AnonymousPlayer.id == QuizAttempt.player_id)
        .order_by(ranked.c.rank)
        .limit(limit)
    ).all()

    current_player_attempt = db.execute(
        select(QuizAttempt, AnonymousPlayer.display_name, ranked.c.rank)
        .join(ranked, ranked.c.attempt_id == QuizAttempt.id)
        .join(AnonymousPlayer, AnonymousPlayer.id == QuizAttempt.player_id)
        .where(AnonymousPlayer.id == player.id)
    ).first()

    entries: list[LeaderboardEntry] = []
    for attempt, display_name, rank in attempts:
        entries.append(_leaderboard_entry(attempt, display_name, rank, attempt.player_id == player.id))

    if current_player_attempt is not None:
        attempt, display_name, rank = current_player_attempt
        if not any(entry.is_current_player for entry in entries):
            entries.append(_leaderboard_entry(attempt, display_name, rank, True))
    return entries


def _leaderboard_entry(
    attempt: QuizAttempt,
    display_name: str,
    rank: int,
    is_current_player: bool,
) -> LeaderboardEntry:
    duration = None
    if attempt.ended_at:
        duration = int((attempt.ended_at - attempt.started_at).total_seconds())
    return LeaderboardEntry(
        rank=rank,
        display_name=display_name,
        score=attempt.score,
        total_questions=attempt.score,
        accuracy=attempt.accuracy,
        duration_seconds=duration,
        ended_at=attempt.ended_at.isoformat() if attempt.ended_at else None,
        is_current_player=is_current_player,
    )


def _story_passage_out(passage: ReadingPassage) -> StoryPassageOut:
    return StoryPassageOut(
        id=passage.id,
        group=passage.group,
        level=passage.level,
        part=passage.part,
        exercise_type=_exercise_type(passage),
        topic=passage.topic,
        title=passage.title,
        passage_text=passage.passage_text,
        image_url=_stimulus_image_url(passage),
        render_kind=passage.render_kind,
        content=passage.content,
        image_path=passage.image_path,
        transcript=passage.transcript,
        context_label=passage.context_label,
        order_index=passage.order_index,
        questions=[
            StoryQuestionOut(
                id=question.id,
                prompt=question.prompt,
                order_index=question.order_index,
                answers=[
                    StoryAnswerChoiceOut(
                        id=answer.id,
                        answer_text=answer.answer_text,
                        order_index=answer.order_index,
                        ref_stimulus=(
                            StoryOptionStimulusOut(
                                id=answer.ref_stimulus.id,
                                title=answer.ref_stimulus.title,
                                body=answer.ref_stimulus.body,
                                context_label=answer.ref_stimulus.context_label,
                                render_kind=answer.ref_stimulus.render_kind,
                                content=answer.ref_stimulus.content,
                                image_path=answer.ref_stimulus.image_path,
                                image_url=_stimulus_image_url(answer.ref_stimulus),
                                transcript=answer.ref_stimulus.transcript,
                            )
                            if answer.ref_stimulus
                            else None
                        ),
                    )
                    for answer in question.answers
                ],
            )
            for question in passage.questions
        ],
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
    topic = Topic(slug=slug, name=TOPIC_LABELS.get(slug, " ".join(piece.capitalize() for piece in slug.split("_"))))
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
    passage.kind = _stimulus_kind(payload.group, payload.part)
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
    ad_rows = _reading_ad_stimuli_from_payload(payload) if payload.group == "goethe" and payload.part == "teil_2" else []
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
        exercise_type=_exercise_type(passage),
        topic=passage.topic,
        title=passage.title,
        passage_text=passage.passage_text,
        image_url=_stimulus_image_url(passage),
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


def _reading_item_from_payload(question, ad_rows: list[ReadingPassage] | None = None) -> ReadingQuestion:
    item = ReadingQuestion(
        prompt=question.prompt.strip(),
        explanation=_clean_optional_text(question.explanation),
        answer_type="choice" if ad_rows else ("true_false" if _is_true_false_answers(question.answers) else "choice"),
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


class _AdAnswerPayload:
    def __init__(self, *, order_index: int, answer_text: str, is_correct: bool) -> None:
        self.order_index = order_index
        self.answer_text = answer_text
        self.is_correct = is_correct


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


def _exercise_type(passage: ReadingPassage) -> str | None:
    if passage.group != "goethe":
        return None
    if passage.part == "teil_2":
        return "source_choice"
    if passage.part == "teil_3":
        return "true_false_notice"
    return "standard"


def _stimulus_kind(group: str, part: str | None) -> str:
    if group == "goethe" and part == "teil_3":
        return "sign"
    return "text"


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


def _stimulus_image_url(stimulus: ReadingPassage) -> str | None:
    if stimulus.image_url:
        return stimulus.image_url
    if not stimulus.image_path:
        return None
    settings = get_settings()
    if not settings.supabase_url:
        return stimulus.image_path
    return f"{settings.supabase_url.rstrip('/')}/storage/v1/object/public/stimuli/{stimulus.image_path}"


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
