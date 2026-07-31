import json
import random

from sqlalchemy.orm import Session

from app.db.models import QuizAttempt, QuizAttemptQuestion
from app.schemas import QuestionOut
from app.services.words import get_words

WORD_TYPE_CHOICES = ["noun", "verb", "adjective", "adverb"]
ARTICLE_CHOICES = ["der", "die", "das"]


def _shuffle(choices: list[str]) -> list[str]:
    copied = choices[:]
    random.shuffle(copied)
    return copied


def create_question(db: Session, attempt: QuizAttempt) -> QuestionOut:
    question_type, word = _pick_question_candidate(db, attempt)
    if question_type == "article":
        prompt = f"Which article belongs with '{word.word}'?"
        correct_answer = word.article or "das"
        choices = ARTICLE_CHOICES
    else:
        prompt = f"What type of word is '{word.word}'?"
        correct_answer = word.part_of_speech
        choices = WORD_TYPE_CHOICES

    question = QuizAttemptQuestion(
        attempt_id=attempt.id,
        word=word.word,
        question_type=question_type,
        prompt=prompt,
        correct_answer=correct_answer,
        choices_json=json.dumps(_shuffle(choices)),
    )
    db.add(question)
    db.flush()
    return question_to_schema(question)


def _pick_question_candidate(db: Session, attempt: QuizAttempt):
    asked_pairs = {
        (question.word, question.question_type)
        for question in attempt.questions
        if question.answered_at is not None
    }
    candidates = []
    for question_type in ["article", "word_type"]:
        for word in get_words(db, require_article=question_type == "article"):
            if (word.word, question_type) not in asked_pairs:
                candidates.append((question_type, word))

    if not candidates:
        for question_type in ["article", "word_type"]:
            for word in get_words(db, require_article=question_type == "article"):
                candidates.append((question_type, word))

    return random.choice(candidates)


def question_to_schema(question: QuizAttemptQuestion) -> QuestionOut:
    return QuestionOut(
        question_id=question.id,
        word=question.word,
        type=question.question_type,
        prompt=question.prompt,
        choices=json.loads(question.choices_json),
    )
