import json
import random

from sqlalchemy.orm import Session

from app.db.models import QuizAttempt, QuizAttemptQuestion
from app.schemas import QuestionOut
from app.services.words import get_random_word

WORD_TYPE_CHOICES = ["noun", "verb", "adjective", "adverb"]
ARTICLE_CHOICES = ["der", "die", "das"]


def _shuffle(choices: list[str]) -> list[str]:
    copied = choices[:]
    random.shuffle(copied)
    return copied


def create_question(db: Session, attempt: QuizAttempt) -> QuestionOut:
    question_type = random.choice(["article", "word_type"])
    if question_type == "article":
        word = get_random_word(db, require_article=True)
        prompt = f"Which article belongs with '{word.word}'?"
        correct_answer = word.article or "das"
        choices = ARTICLE_CHOICES
    else:
        word = get_random_word(db)
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


def question_to_schema(question: QuizAttemptQuestion) -> QuestionOut:
    return QuestionOut(
        question_id=question.id,
        word=question.word,
        type=question.question_type,
        prompt=question.prompt,
        choices=json.loads(question.choices_json),
    )
