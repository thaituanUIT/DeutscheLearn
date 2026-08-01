from pydantic import BaseModel, Field


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


class LeaderboardEntry(BaseModel):
    rank: int
    display_name: str
    score: int
    total_questions: int
    accuracy: float | None
    duration_seconds: int | None
    ended_at: str | None
    is_current_player: bool = False
