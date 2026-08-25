from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
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


class Word(Base):
    __tablename__ = "word"
    __table_args__ = (
        CheckConstraint("article in ('der', 'die', 'das') or article is null", name="ck_word_article"),
        CheckConstraint(
            "article is null or part_of_speech = 'noun'",
            name="ck_word_article_only_for_noun",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    lemma: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    article: Mapped[str | None] = mapped_column(String(8))
    part_of_speech: Mapped[str] = mapped_column(String(80), nullable=False)
    meaning: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )

    focus_entries: Mapped[list["WordFocus"]] = relationship(
        back_populates="word",
        cascade="all, delete-orphan",
    )

    def __init__(self, lemma: str | None = None, word: str | None = None, **kwargs) -> None:
        super().__init__(lemma=lemma or word, **kwargs)

    @property
    def word(self) -> str:
        return self.lemma


class Topic(Base):
    __tablename__ = "topic"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)

    focus_entries: Mapped[list["WordFocus"]] = relationship(back_populates="topic")


class WordFocus(Base):
    __tablename__ = "word_focus"
    __table_args__ = (
        UniqueConstraint("word_id", "level", "topic_id", name="uq_word_focus_word_level_topic"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    word_id: Mapped[str] = mapped_column(ForeignKey("word.id"), nullable=False, index=True)
    level: Mapped[str] = mapped_column(String(8), nullable=False)
    topic_id: Mapped[str] = mapped_column(ForeignKey("topic.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)

    word: Mapped[Word] = relationship(back_populates="focus_entries")
    topic: Mapped[Topic] = relationship(back_populates="focus_entries")


class Stimulus(Base):
    __tablename__ = "stimulus"
    __table_args__ = (
        CheckConstraint("collection in ('general', 'goethe')", name="ck_stimulus_collection"),
        CheckConstraint("level in ('A1', 'A2', 'B1', 'B2')", name="ck_stimulus_level"),
        CheckConstraint("teil in ('teil_1', 'teil_2', 'teil_3', 'teil_4', 'teil_5') or teil is null", name="ck_stimulus_teil"),
        CheckConstraint("kind in ('text', 'ad', 'sign')", name="ck_stimulus_kind"),
        CheckConstraint(
            "render_kind = 'image' or image_path is null",
            name="ck_stimulus_image_path_only_for_image",
        ),
        CheckConstraint(
            "render_kind <> 'image' or transcript is not null",
            name="ck_stimulus_image_has_transcript",
        ),
        CheckConstraint("status in ('draft', 'published')", name="ck_stimulus_status"),
        CheckConstraint("collection <> 'goethe' or teil is not null", name="ck_goethe_stimulus_has_teil"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    collection: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    level: Mapped[str] = mapped_column(String(8), nullable=False)
    teil: Mapped[str | None] = mapped_column(String(40), index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(500))
    render_kind: Mapped[str] = mapped_column(String(40), default="text", nullable=False)
    content: Mapped[dict | None] = mapped_column(JSON)
    image_path: Mapped[str | None] = mapped_column(String(500))
    transcript: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="published", nullable=False)
    audio_url: Mapped[str | None] = mapped_column(String(500))
    context_label: Mapped[str | None] = mapped_column(String(160))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )

    items: Mapped[list["Item"]] = relationship(
        back_populates="stimulus",
        cascade="all, delete-orphan",
        foreign_keys="Item.stimulus_id",
        order_by="Item.sort_order",
    )
    referenced_by_options: Mapped[list["ItemOption"]] = relationship(
        back_populates="ref_stimulus",
        foreign_keys="ItemOption.ref_stimulus_id",
    )

    def __init__(
        self,
        collection: str | None = None,
        group: str | None = None,
        teil: str | None = None,
        part: str | None = None,
        kind: str = "text",
        body: str | None = None,
        passage_text: str | None = None,
        sort_order: int | None = None,
        order_index: int | None = None,
        questions: list["Item"] | None = None,
        items: list["Item"] | None = None,
        **kwargs,
    ) -> None:
        kwargs.pop("topic", None)
        super().__init__(
            collection=collection or group or "general",
            teil=teil or part,
            kind=kind,
            body=body if body is not None else passage_text,
            sort_order=sort_order if sort_order is not None else (order_index or 0),
            items=items if items is not None else (questions or []),
            **kwargs,
        )

    @property
    def group(self) -> str:
        return self.collection

    @property
    def part(self) -> str | None:
        return self.teil

    @property
    def topic(self) -> None:
        return None

    @property
    def passage_text(self) -> str:
        return self.body

    @property
    def order_index(self) -> int:
        return self.sort_order

    @property
    def questions(self) -> list["Item"]:
        return self.items


class Item(Base):
    __tablename__ = "item"
    __table_args__ = (
        CheckConstraint("answer_type in ('true_false', 'choice')", name="ck_item_answer_type"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    stimulus_id: Mapped[str] = mapped_column(ForeignKey("stimulus.id"), nullable=False, index=True)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str | None] = mapped_column(Text)
    answer_type: Mapped[str] = mapped_column(String(40), nullable=False)
    correct_option_id: Mapped[str | None] = mapped_column(ForeignKey("item_option.id", use_alter=True))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    stimulus: Mapped[Stimulus] = relationship(back_populates="items", foreign_keys=[stimulus_id])
    options: Mapped[list["ItemOption"]] = relationship(
        back_populates="item",
        cascade="all, delete-orphan",
        foreign_keys="ItemOption.item_id",
        order_by="ItemOption.sort_order",
    )
    correct_option: Mapped["ItemOption | None"] = relationship(foreign_keys=[correct_option_id], post_update=True)

    def __init__(
        self,
        answers: list["ItemOption"] | None = None,
        options: list["ItemOption"] | None = None,
        order_index: int | None = None,
        sort_order: int | None = None,
        answer_type: str | None = None,
        **kwargs,
    ) -> None:
        option_rows = options if options is not None else (answers or [])
        super().__init__(
            options=option_rows,
            sort_order=sort_order if sort_order is not None else (order_index or 0),
            answer_type=answer_type or ("true_false" if _options_look_true_false(option_rows) else "choice"),
            **kwargs,
        )
        self.correct_option = next((option for option in option_rows if option.is_correct), None)

    @property
    def order_index(self) -> int:
        return self.sort_order

    @property
    def answers(self) -> list["ItemOption"]:
        return self.options


class ItemOption(Base):
    __tablename__ = "item_option"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    item_id: Mapped[str] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    ref_stimulus_id: Mapped[str | None] = mapped_column(ForeignKey("stimulus.id"), index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    item: Mapped[Item] = relationship(back_populates="options", foreign_keys=[item_id])
    ref_stimulus: Mapped[Stimulus | None] = relationship(back_populates="referenced_by_options", foreign_keys=[ref_stimulus_id])

    _legacy_is_correct: bool = False

    def __init__(
        self,
        label: str | None = None,
        answer_text: str | None = None,
        sort_order: int | None = None,
        order_index: int | None = None,
        is_correct: bool = False,
        **kwargs,
    ) -> None:
        key = kwargs.pop("key", None)
        resolved_order = sort_order if sort_order is not None else (order_index or 0)
        super().__init__(
            label=label if label is not None else answer_text,
            sort_order=resolved_order,
            key=str(key if key is not None else resolved_order),
            **kwargs,
        )
        self._legacy_is_correct = is_correct

    @property
    def answer_text(self) -> str:
        return self.label

    @property
    def is_correct(self) -> bool:
        return self._legacy_is_correct or (self.item is not None and self.item.correct_option_id == self.id)

    @property
    def order_index(self) -> int:
        return self.sort_order

    @property
    def question(self) -> Item:
        return self.item


CachedWord = Word
FocusWordEntry = WordFocus
ReadingPassage = Stimulus
ReadingQuestion = Item
ReadingAnswer = ItemOption


class Upload(Base):
    __tablename__ = "upload"

    path: Mapped[str] = mapped_column(String(500), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    stimulus_id: Mapped[str | None] = mapped_column(ForeignKey("stimulus.id"), index=True)
    delete_after_at: Mapped[datetime | None] = mapped_column(DateTime)


class GrammarDocument(Base):
    __tablename__ = "grammar_documents"

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    level: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    topic: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    source_path: Mapped[str] = mapped_column(String(500), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(20), default="markdown", nullable=False)
    metadata_json: Mapped[str | None] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )


class GrammarChunk(Base):
    __tablename__ = "grammar_chunks"

    id: Mapped[str] = mapped_column(String(160), primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("grammar_documents.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    section: Mapped[str] = mapped_column(String(200), nullable=False)
    level: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    topic: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    source_path: Mapped[str] = mapped_column(String(500), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(20), default="markdown", nullable=False)
    page_start: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    metadata_json: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )


class GrammarAnswerCache(Base):
    __tablename__ = "grammar_answer_cache"
    __table_args__ = (
        UniqueConstraint("question_hash", "level", name="uq_grammar_answer_cache_question_level"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    question_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    level: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    normalized_question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    citations_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)


def _options_look_true_false(options: list[ItemOption]) -> bool:
    labels = {option.label.casefold() for option in options}
    return labels <= {"richtig", "falsch", "true", "false"} and len(labels) == 2


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
