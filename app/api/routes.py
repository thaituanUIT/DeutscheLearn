import json
from secrets import compare_digest

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
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
)
from app.db.session import get_db
from app.schemas import (
    AdminFocusEntryOut,
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
    LeaderboardEntry,
    PlayerOut,
    PracticeAnswerOut,
    PracticeStartOut,
    StoryAnswerChoiceOut,
    StoryAnswerIn,
    StoryAnswerOut,
    StoryGroupOut,
    StoryLevelOut,
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
    query = select(CachedWord).options(selectinload(CachedWord.focus_entries))
    if search.strip():
        query = query.where(CachedWord.word.ilike(f"%{search.strip()}%"))
    if level or topic:
        query = query.join(FocusWordEntry)
        if level:
            query = query.where(FocusWordEntry.level == level)
        if topic:
            query = query.where(FocusWordEntry.topic == topic)
    query = query.order_by(CachedWord.word).limit(200)
    words = db.scalars(query).unique().all()
    return [_admin_word_out(word) for word in words]


@router.post(
    "/admin/words",
    response_model=AdminWordOut,
    dependencies=[Depends(require_admin)],
)
def admin_create_word(payload: AdminWordIn, db: Session = Depends(get_db)) -> AdminWordOut:
    word_key = payload.word.strip()
    if db.get(CachedWord, word_key) is not None:
        raise HTTPException(status_code=409, detail="Word already exists")
    _validate_focus_entries(payload.focus_entries)
    word = CachedWord(
        word=word_key,
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
    word = db.get(CachedWord, word_key)
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
    word = db.get(CachedWord, word_key)
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
    level: str | None = Query(default=None, pattern="^(A1|A2|B1|B2)$"),
    db: Session = Depends(get_db),
) -> list[AdminReadingPassageSummaryOut]:
    question_counts = (
        select(ReadingQuestion.passage_id, func.count(ReadingQuestion.id).label("question_count"))
        .group_by(ReadingQuestion.passage_id)
        .subquery()
    )
    query = (
        select(ReadingPassage, func.coalesce(question_counts.c.question_count, 0))
        .outerjoin(question_counts, question_counts.c.passage_id == ReadingPassage.id)
        .order_by(ReadingPassage.level, ReadingPassage.order_index, ReadingPassage.title)
    )
    if level:
        query = query.where(ReadingPassage.level == level)
    rows = db.execute(query).all()
    return [
        AdminReadingPassageSummaryOut(
            id=passage.id,
            group=passage.group,
            level=passage.level,
            part=passage.part,
            exercise_type=passage.exercise_type,
            topic=passage.topic,
            title=passage.title,
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
    passage = ReadingPassage()
    db.add(passage)
    _apply_reading_payload(passage, payload)
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
    db.commit()
    return _admin_reading_passage_out(passage)


@router.delete(
    "/admin/reading/passages/{passage_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
def admin_delete_reading_passage(passage_id: str, db: Session = Depends(get_db)) -> None:
    passage = _get_reading_passage(db, passage_id)
    db.delete(passage)
    db.commit()


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
        exercise_type=passage.exercise_type,
        topic=passage.topic,
        title=passage.title,
        passage_text=passage.passage_text,
        content=_reading_content(passage.content_json),
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
            AdminFocusEntryOut(id=entry.id, level=entry.level, topic=entry.topic)
            for entry in sorted(word.focus_entries, key=lambda item: (item.level, item.topic))
        ],
    )


def _replace_focus_entries(
    db: Session,
    word: str,
    entries: list,
) -> None:
    existing = db.scalars(select(FocusWordEntry).where(FocusWordEntry.word == word)).all()
    for entry in existing:
        db.delete(entry)
    db.flush()

    seen = set()
    for entry in entries:
        key = (entry.level, entry.topic.strip())
        if key in seen:
            continue
        seen.add(key)
        db.add(FocusWordEntry(word=word, level=entry.level, topic=key[1]))


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


def _get_reading_passage(db: Session, passage_id: str) -> ReadingPassage:
    passage = db.scalar(
        select(ReadingPassage)
        .options(selectinload(ReadingPassage.questions).selectinload(ReadingQuestion.answers))
        .where(ReadingPassage.id == passage_id)
    )
    if passage is None:
        raise HTTPException(status_code=404, detail="Reading passage not found")
    return passage


def _apply_reading_payload(passage: ReadingPassage, payload: AdminReadingPassageIn) -> None:
    passage.group = payload.group
    passage.level = payload.level
    passage.part = payload.part if payload.group == "goethe" else None
    passage.exercise_type = _clean_optional_text(payload.exercise_type)
    passage.topic = _clean_optional_text(payload.topic)
    passage.title = payload.title.strip()
    passage.passage_text = payload.passage_text.strip()
    passage.content_json = _clean_content_json(payload.content_json)
    passage.order_index = payload.order_index
    passage.updated_at = utc_now()
    passage.questions = [
        ReadingQuestion(
            prompt=question.prompt.strip(),
            explanation=_clean_optional_text(question.explanation),
            order_index=question.order_index,
            answers=[
                ReadingAnswer(
                    answer_text=answer.answer_text.strip(),
                    is_correct=answer.is_correct,
                    order_index=answer.order_index,
                )
                for answer in question.answers
            ],
        )
        for question in payload.questions
    ]


def _admin_reading_passage_out(passage: ReadingPassage) -> AdminReadingPassageOut:
    return AdminReadingPassageOut(
        id=passage.id,
        group=passage.group,
        level=passage.level,
        part=passage.part,
        exercise_type=passage.exercise_type,
        topic=passage.topic,
        title=passage.title,
        passage_text=passage.passage_text,
        content_json=passage.content_json,
        order_index=passage.order_index,
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


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = " ".join(value.split())
    return text or None


def _clean_content_json(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=422, detail=f"Invalid content JSON: {error.msg}") from error
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=422, detail="Content JSON must be an object")
    return json.dumps(parsed, ensure_ascii=False)


def _reading_content(value: str | None) -> dict | None:
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None
