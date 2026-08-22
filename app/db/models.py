from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utc_now
from app.db.session import Base


def new_uuid() -> str:
    return str(uuid4())


class AnonymousPlayer(Base):
    __tablename__ = "anonymous_players"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    display_name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    best_endless_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_games_played: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    attempts: Mapped[list["QuizAttempt"]] = relationship(back_populates="player")


class CachedWord(Base):
    __tablename__ = "cached_words"

    word: Mapped[str] = mapped_column(String(120), primary_key=True)
    article: Mapped[str | None] = mapped_column(String(8))
    part_of_speech: Mapped[str] = mapped_column(String(80), nullable=False)
    meaning: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    focus_entries: Mapped[list["FocusWordEntry"]] = relationship(back_populates="cached_word")


class FocusWordEntry(Base):
    __tablename__ = "focus_word_entries"
    __table_args__ = (
        UniqueConstraint("word", "topic", "level", name="uq_focus_word_topic_level"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    word: Mapped[str] = mapped_column(ForeignKey("cached_words.word"), nullable=False)
    topic: Mapped[str] = mapped_column(String(80), nullable=False)
    level: Mapped[str] = mapped_column(String(8), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    cached_word: Mapped[CachedWord] = relationship(back_populates="focus_entries")


class ReadingPassage(Base):
    __tablename__ = "reading_passages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    group: Mapped[str] = mapped_column(String(40), default="general", nullable=False)
    level: Mapped[str] = mapped_column(String(8), nullable=False)
    part: Mapped[str | None] = mapped_column(String(40))
    topic: Mapped[str | None] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    passage_text: Mapped[str] = mapped_column(Text, nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )

    questions: Mapped[list["ReadingQuestion"]] = relationship(
        back_populates="passage",
        cascade="all, delete-orphan",
        order_by="ReadingQuestion.order_index",
    )


class ReadingQuestion(Base):
    __tablename__ = "reading_questions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    passage_id: Mapped[str] = mapped_column(ForeignKey("reading_passages.id"), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str | None] = mapped_column(Text)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    passage: Mapped[ReadingPassage] = relationship(back_populates="questions")
    answers: Mapped[list["ReadingAnswer"]] = relationship(
        back_populates="question",
        cascade="all, delete-orphan",
        order_by="ReadingAnswer.order_index",
    )


class ReadingAnswer(Base):
    __tablename__ = "reading_answers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    question_id: Mapped[str] = mapped_column(ForeignKey("reading_questions.id"), nullable=False)
    answer_text: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    question: Mapped[ReadingQuestion] = relationship(back_populates="answers")


class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    player_id: Mapped[str] = mapped_column(ForeignKey("anonymous_players.id"), nullable=False)
    mode: Mapped[str] = mapped_column(String(40), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)
    score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_questions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    accuracy: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    ended_reason: Mapped[str | None] = mapped_column(String(40))

    player: Mapped[AnonymousPlayer] = relationship(back_populates="attempts")
    questions: Mapped[list["QuizAttemptQuestion"]] = relationship(back_populates="attempt")


class QuizAttemptQuestion(Base):
    __tablename__ = "quiz_attempt_questions"
    __table_args__ = (UniqueConstraint("attempt_id", "id", name="uq_attempt_question"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    attempt_id: Mapped[str] = mapped_column(ForeignKey("quiz_attempts.id"), nullable=False)
    word: Mapped[str] = mapped_column(String(120), nullable=False)
    question_type: Mapped[str] = mapped_column(String(40), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    correct_answer: Mapped[str] = mapped_column(String(160), nullable=False)
    choices_json: Mapped[str] = mapped_column(Text, nullable=False)
    selected_answer: Mapped[str | None] = mapped_column(String(160))
    is_correct: Mapped[bool | None] = mapped_column(Boolean)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime)

    attempt: Mapped[QuizAttempt] = relationship(back_populates="questions")
