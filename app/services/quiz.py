import json
import random

from sqlalchemy import select
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
    normalized_part_of_speech = _normalize_part_of_speech(word.part_of_speech)
    display_word = _display_word(question_type, word.word, normalized_part_of_speech)
    if question_type == "article":
        prompt = f"Which article belongs with '{display_word}'?"
        correct_answer = word.article or "das"
        choices = ARTICLE_CHOICES
    else:
        prompt = f"What type of word is '{display_word}'?"
        correct_answer = normalized_part_of_speech
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
    }
    player_seen_pairs = set(
        db.execute(
            select(QuizAttemptQuestion.word, QuizAttemptQuestion.question_type)
            .join(QuizAttempt, QuizAttempt.id == QuizAttemptQuestion.attempt_id)
            .where(QuizAttempt.player_id == attempt.player_id)
        ).all()
    )
    candidates = []
    for question_type in ["article", "word_type"]:
        for word in get_words(db, require_article=question_type == "article"):
            if question_type == "word_type" and (
                _normalize_part_of_speech(word.part_of_speech) not in WORD_TYPE_CHOICES
            ):
                continue
            pair = (word.word, question_type)
            if pair not in asked_pairs and pair not in player_seen_pairs:
                candidates.append((question_type, word))

    if not candidates:
        for question_type in ["article", "word_type"]:
            for word in get_words(db, require_article=question_type == "article"):
                if question_type == "word_type" and (
                    _normalize_part_of_speech(word.part_of_speech) not in WORD_TYPE_CHOICES
                ):
                    continue
                if (word.word, question_type) not in asked_pairs:
                    candidates.append((question_type, word))

    if not candidates:
        for question_type in ["article", "word_type"]:
            for word in get_words(db, require_article=question_type == "article"):
                if question_type == "word_type" and (
                    _normalize_part_of_speech(word.part_of_speech) not in WORD_TYPE_CHOICES
                ):
                    continue
                candidates.append((question_type, word))

    return random.choice(candidates)


def _display_word(question_type: str, word: str, part_of_speech: str) -> str:
    if question_type == "word_type" and part_of_speech == "noun":
        return word.lower()
    return word


def _normalize_part_of_speech(part_of_speech: str) -> str:
    lowered = part_of_speech.casefold()
    if "substantiv" in lowered or lowered == "noun":
        return "noun"
    if "verb" in lowered:
        return "verb"
    if "adjektiv" in lowered or lowered == "adjective":
        return "adjective"
    if "adverb" in lowered:
        return "adverb"
    return "unknown"


def question_to_schema(question: QuizAttemptQuestion) -> QuestionOut:
    return QuestionOut(
        question_id=question.id,
        word=_display_word(question.question_type, question.word, question.correct_answer),
        type=question.question_type,
        prompt=question.prompt,
        choices=json.loads(question.choices_json),
    )
