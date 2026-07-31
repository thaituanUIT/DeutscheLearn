import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_or_create_player, require_player
from app.core.time import utc_now
from app.db.models import AnonymousPlayer, QuizAttempt, QuizAttemptQuestion
from app.db.session import get_db
from app.schemas import (
    EndlessAnswerIn,
    EndlessAnswerOut,
    EndlessStartOut,
    LeaderboardEntry,
    PlayerOut,
    PracticeAnswerOut,
    PracticeStartOut,
    TimedAnswerOut,
    TimedStartOut,
)
from app.services.quiz import create_question

router = APIRouter(prefix="/api")
TIMED_DURATION_SECONDS = 60


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
    db: Session = Depends(get_db),
) -> list[LeaderboardEntry]:
    ranked = (
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
        .subquery()
    )

    attempts = db.execute(
        select(QuizAttempt, AnonymousPlayer.display_name)
        .join(ranked, ranked.c.attempt_id == QuizAttempt.id)
        .join(AnonymousPlayer, AnonymousPlayer.id == QuizAttempt.player_id)
        .where(ranked.c.player_rank == 1)
        .order_by(
            QuizAttempt.score.desc(),
            QuizAttempt.accuracy.desc(),
            QuizAttempt.ended_at.asc(),
        )
        .limit(limit)
    ).all()

    entries: list[LeaderboardEntry] = []
    for rank, (attempt, display_name) in enumerate(attempts, start=1):
        duration = None
        if attempt.ended_at:
            duration = int((attempt.ended_at - attempt.started_at).total_seconds())
        entries.append(
            LeaderboardEntry(
                rank=rank,
                display_name=display_name,
                score=attempt.score,
                total_questions=attempt.score,
                accuracy=attempt.accuracy,
                duration_seconds=duration,
                ended_at=attempt.ended_at.isoformat() if attempt.ended_at else None,
            )
        )
    return entries
