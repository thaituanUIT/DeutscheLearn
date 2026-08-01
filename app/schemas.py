from pydantic import BaseModel, Field, model_validator


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


class AdminReadingPassageIn(BaseModel):
    level: str = Field(pattern="^(A1|A2|B1|B2)$")
    topic: str | None = Field(default=None, max_length=80)
    title: str = Field(min_length=1, max_length=160)
    passage_text: str = Field(min_length=1)
    order_index: int = Field(default=0, ge=0)
    questions: list[AdminReadingQuestionIn] = Field(default_factory=list)


class AdminReadingPassageSummaryOut(BaseModel):
    id: str
    level: str
    topic: str | None
    title: str
    order_index: int
    question_count: int


class AdminReadingPassageOut(BaseModel):
    id: str
    level: str
    topic: str | None
    title: str
    passage_text: str
    order_index: int
    questions: list[AdminReadingQuestionOut]


class LeaderboardEntry(BaseModel):
    rank: int
    display_name: str
    score: int
    total_questions: int
    accuracy: float | None
    duration_seconds: int | None
    ended_at: str | None
    is_current_player: bool = False
