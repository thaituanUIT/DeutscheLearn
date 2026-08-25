from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

RenderKind = Literal[
    "text",
    "image",
    "website_box",
    "ad_box",
    "hours_table",
    "notice_sheet",
    "door_sign",
    "timetable",
    "pictogram_sign",
]


class PlayerOut(BaseModel):
    player_id: str
    display_name: str
    best_endless_score: int


class WordOfDayOut(BaseModel):
    word: str
    article: str | None
    part_of_speech: str
    meaning: str
    date: str


class QuestionOut(BaseModel):
    question_id: str
    word: str
    type: str
    prompt: str
    choices: list[str]


class EndlessStartOut(BaseModel):
    attempt_id: str
    score: int
    question: QuestionOut


class PracticeStartOut(BaseModel):
    attempt_id: str
    score: int
    total_questions: int
    question: QuestionOut


class TimedStartOut(BaseModel):
    attempt_id: str
    score: int
    total_questions: int
    duration_seconds: int
    question: QuestionOut


class EndlessAnswerIn(BaseModel):
    attempt_id: str
    question_id: str
    selected_answer: str = Field(min_length=1, max_length=160)


class EndlessAnswerOut(BaseModel):
    correct: bool
    score: int
    correct_answer: str
    answered_word: str
    meaning_overview: str
    attempt_finished: bool
    next_question: QuestionOut | None = None


class PracticeAnswerOut(BaseModel):
    correct: bool
    score: int
    total_questions: int
    correct_answer: str
    next_question: QuestionOut


class TimedAnswerOut(BaseModel):
    correct: bool
    score: int
    total_questions: int
    correct_answer: str
    attempt_finished: bool
    seconds_remaining: int
    next_question: QuestionOut | None = None


class FocusLevelOut(BaseModel):
    level: str
    word_count: int
    topic_count: int


class FocusTopicOut(BaseModel):
    topic: str
    label: str
    word_count: int


class FocusTopicAliasOut(BaseModel):
    topic: str
    label: str


class FocusCardOut(BaseModel):
    word: str
    article: str | None
    part_of_speech: str
    meaning_overview: str
    topic: str
    topic_label: str
    level: str


class FocusRevisionQuestionOut(BaseModel):
    word: str
    article: str | None
    part_of_speech: str
    meaning_overview: str
    topic: str
    topic_label: str
    level: str
    choices: list[str]
    correct_answer: str


class StoryLevelOut(BaseModel):
    level: str
    passage_count: int
    question_count: int


class StoryGroupOut(BaseModel):
    group: str
    label: str
    passage_count: int
    question_count: int


class StoryPartOut(BaseModel):
    part: str
    label: str
    passage_count: int
    question_count: int


class StoryPassageSummaryOut(BaseModel):
    id: str
    group: str
    level: str
    part: str | None
    exercise_type: str | None
    topic: str | None
    title: str
    order_index: int
    question_count: int


class StoryOptionStimulusOut(BaseModel):
    id: str
    title: str
    body: str
    context_label: str | None
    render_kind: str
    content: dict[str, Any] | None
    image_path: str | None
    image_url: str | None
    transcript: str | None


class StoryAnswerChoiceOut(BaseModel):
    id: str
    answer_text: str
    order_index: int
    ref_stimulus: StoryOptionStimulusOut | None = None


class StoryQuestionOut(BaseModel):
    id: str
    prompt: str
    order_index: int
    answers: list[StoryAnswerChoiceOut]


class StoryPassageOut(BaseModel):
    id: str
    group: str
    level: str
    part: str | None
    exercise_type: str | None
    topic: str | None
    title: str
    passage_text: str
    image_url: str | None
    render_kind: str
    content: dict[str, Any] | None
    image_path: str | None
    transcript: str | None
    context_label: str | None
    order_index: int
    questions: list[StoryQuestionOut]


class StoryAnswerIn(BaseModel):
    question_id: str = Field(min_length=1)
    answer_id: str = Field(min_length=1)


class StoryAnswerOut(BaseModel):
    correct: bool
    correct_answer_id: str
    correct_answer_text: str
    explanation: str | None


class AdminFocusEntryIn(BaseModel):
    level: str = Field(pattern="^(A1|A2|B1|B2)$")
    topic: str = Field(min_length=1, max_length=80)


class AdminFocusEntryOut(AdminFocusEntryIn):
    id: str


class AdminWordIn(BaseModel):
    word: str = Field(min_length=1, max_length=120)
    article: str | None = Field(default=None, max_length=8)
    part_of_speech: str = Field(min_length=1, max_length=80)
    meaning: str = Field(min_length=1)
    focus_entries: list[AdminFocusEntryIn] = Field(default_factory=list)


class AdminWordPatchIn(BaseModel):
    article: str | None = Field(default=None, max_length=8)
    part_of_speech: str = Field(min_length=1, max_length=80)
    meaning: str = Field(min_length=1)
    focus_entries: list[AdminFocusEntryIn] = Field(default_factory=list)


class AdminWordOut(BaseModel):
    word: str
    article: str | None
    part_of_speech: str
    meaning: str
    focus_entries: list[AdminFocusEntryOut]


class AdminReadingAnswerIn(BaseModel):
    answer_text: str = Field(min_length=1)
    is_correct: bool = False
    order_index: int = Field(default=0, ge=0)


class AdminReadingAnswerOut(AdminReadingAnswerIn):
    id: str


class AdminReadingQuestionIn(BaseModel):
    prompt: str = Field(min_length=1)
    explanation: str | None = None
    order_index: int = Field(default=0, ge=0)
    answers: list[AdminReadingAnswerIn] = Field(min_length=2)

    @model_validator(mode="after")
    def require_one_correct_answer(self) -> "AdminReadingQuestionIn":
        if sum(1 for answer in self.answers if answer.is_correct) != 1:
            raise ValueError("Each reading question must have exactly one correct answer")
        return self


class AdminReadingQuestionOut(BaseModel):
    id: str
    prompt: str
    explanation: str | None
    order_index: int
    answers: list[AdminReadingAnswerOut]


class AdminReadingAdIn(BaseModel):
    id: str | None = None
    key: str = Field(pattern="^[ab]$")
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1)
    render_kind: RenderKind = "website_box"
    content: dict[str, Any] | None = None
    image_path: str | None = Field(default=None, max_length=500)
    transcript: str | None = None
    context_label: str | None = Field(default=None, max_length=160)
    order_index: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def validate_render_content(self) -> "AdminReadingAdIn":
        validate_stimulus_content(self.render_kind, self.content, self.image_path, self.transcript)
        if self.render_kind == "image":
            self.body = self.transcript or self.body
        return self


class AdminReadingAdOut(AdminReadingAdIn):
    id: str


class AdminReadingPassageIn(BaseModel):
    id: str | None = None
    group: str = Field(default="general", pattern="^(general|goethe)$")
    level: str = Field(pattern="^(A1|A2|B1|B2)$")
    part: str | None = Field(default=None, pattern="^teil_[1-5]$")
    topic: str | None = Field(default=None, max_length=80)
    title: str = Field(min_length=1, max_length=160)
    passage_text: str = Field(min_length=1)
    image_url: str | None = Field(default=None, max_length=500)
    render_kind: RenderKind = "text"
    content: dict[str, Any] | None = None
    image_path: str | None = Field(default=None, max_length=500)
    transcript: str | None = None
    context_label: str | None = Field(default=None, max_length=160)
    order_index: int = Field(default=0, ge=0)
    status: Literal["draft", "published"] = "published"
    questions: list[AdminReadingQuestionIn] = Field(default_factory=list)
    ad_stimuli: list[AdminReadingAdIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_goethe_shape(self) -> "AdminReadingPassageIn":
        if self.group != "goethe":
            self.part = None
            self.ad_stimuli = []
            self.render_kind = "text"
            self.content = None
            self.image_path = None
            self.transcript = None
            return self
        if self.part == "teil_2" and len(self.ad_stimuli) != 2:
            raise ValueError("Goethe Teil 2 needs exactly two adverts.")
        if self.part == "teil_2":
            for ad in self.ad_stimuli:
                if ad.render_kind not in {"image", "website_box", "ad_box"}:
                    raise ValueError("Goethe Teil 2 stimuli must use website_box, ad_box, or image.")
            self.render_kind = "text"
            self.content = None
            self.image_path = None
            self.transcript = None
        elif self.part == "teil_3":
            validate_stimulus_content(self.render_kind, self.content, self.image_path, self.transcript)
        else:
            self.render_kind = "text"
            self.content = None
            self.image_path = None
            self.transcript = None
        return self


class AdminReadingPassageSummaryOut(BaseModel):
    id: str
    group: str
    level: str
    part: str | None
    exercise_type: str | None
    topic: str | None
    title: str
    status: str
    order_index: int
    question_count: int


class AdminReadingPassageOut(BaseModel):
    id: str
    group: str
    level: str
    part: str | None
    exercise_type: str | None
    topic: str | None
    title: str
    passage_text: str
    image_url: str | None
    render_kind: str
    content: dict[str, Any] | None
    image_path: str | None
    transcript: str | None
    context_label: str | None
    status: str
    order_index: int
    ad_stimuli: list[AdminReadingAdOut]
    questions: list[AdminReadingQuestionOut]


class StimulusImageUploadUrlIn(BaseModel):
    content_type: str = Field(pattern="^image/(jpeg|png|webp)$")
    size: int = Field(gt=0, le=2 * 1024 * 1024)


class StimulusImageUploadUrlOut(BaseModel):
    bucket: str
    path: str
    token: str
    upload_url: str


class GrammarAskIn(BaseModel):
    question: str = Field(min_length=1, max_length=1200)
    level: str = Field(pattern="^(A1|A2|B1)$")
    topic: str | None = Field(default=None, max_length=120)
    learner_id: str | None = Field(default=None, max_length=120)
    include_debug: bool = False


class GrammarCitationOut(BaseModel):
    chunk_id: str
    title: str
    section: str
    content: str
    level: str
    topic: str
    similarity: float
    source_path: str
    source_kind: str
    page_start: int | None = None
    page_end: int | None = None


class GrammarAskOut(BaseModel):
    status: Literal["answered", "no_match"]
    answer: str | None = None
    citations: list[GrammarCitationOut] = Field(default_factory=list)
    retrieval_debug: dict[str, Any] | None = None
    cached: bool = False


def validate_stimulus_content(
    render_kind: str,
    content: dict[str, Any] | None,
    image_path: str | None,
    transcript: str | None,
) -> None:
    if render_kind == "image":
        if not image_path:
            raise ValueError("Image stimuli need an uploaded image.")
        if not transcript or not transcript.strip():
            raise ValueError("Image stimuli need a faithful transcript.")
        return

    if render_kind == "text":
        return

    if content is None:
        raise ValueError(f"{render_kind} needs structured content.")
    if image_path:
        raise ValueError("Template stimuli cannot have an image path.")

    if render_kind == "website_box":
        _require_string(content, "url")
        lines = _require_list(content, "lines", min_length=2, max_length=4)
        for line in lines:
            if not isinstance(line, str) or not line.strip():
                raise ValueError("website_box lines must be non-empty strings.")
        return
    if render_kind == "ad_box":
        lines = _require_list(content, "lines", min_length=1, max_length=4)
        for line in lines:
            if not isinstance(line, str) or not line.strip():
                raise ValueError("ad_box lines must be non-empty strings.")
        return
    if render_kind == "hours_table":
        _require_string(content, "place_name")
        _require_rows(content, "rows", ["label", "value"], min_length=2)
        return
    if render_kind == "notice_sheet":
        _require_string(content, "heading")
        lines = _require_list(content, "body_lines", min_length=1)
        for line in lines:
            if not isinstance(line, str) or not line.strip():
                raise ValueError("notice_sheet body_lines must be non-empty strings.")
        return
    if render_kind == "door_sign":
        _require_string(content, "message")
        return
    if render_kind == "timetable":
        _require_string(content, "route_name")
        _require_rows(content, "rows", ["time"], min_length=2)
        return
    if render_kind == "pictogram_sign":
        _require_string(content, "message")
        icon = _require_string(content, "icon")
        allowed_icons = {"dog", "smoking", "bicycle", "camera", "food", "phone", "parking", "swimming", "warning", "arrow"}
        if icon not in allowed_icons:
            raise ValueError("pictogram_sign icon is not supported.")
        return
    raise ValueError(f"Unsupported render kind: {render_kind}")


def _require_string(content: dict[str, Any], key: str) -> str:
    value = content.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} is required.")
    return value


def _require_list(
    content: dict[str, Any],
    key: str,
    min_length: int,
    max_length: int | None = None,
) -> list[Any]:
    value = content.get(key)
    if not isinstance(value, list) or len(value) < min_length:
        raise ValueError(f"{key} needs at least {min_length} entries.")
    if max_length is not None and len(value) > max_length:
        raise ValueError(f"{key} allows at most {max_length} entries.")
    return value


def _require_rows(
    content: dict[str, Any],
    key: str,
    required_keys: list[str],
    min_length: int,
) -> None:
    rows = _require_list(content, key, min_length=min_length)
    for row in rows:
        if not isinstance(row, dict):
            raise TypeError(f"{key} entries must be objects.")
        for required_key in required_keys:
            value = row.get(required_key)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{key}.{required_key} is required.")


class LeaderboardEntry(BaseModel):
    rank: int
    display_name: str
    score: int
    total_questions: int
    accuracy: float | None
    duration_seconds: int | None
    ended_at: str | None
    is_current_player: bool = False
