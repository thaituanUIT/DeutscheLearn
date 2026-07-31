import json
from typing import ClassVar
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.time import utc_now
from app.db.models import AnonymousPlayer, QuizAttempt, QuizAttemptQuestion
from app.db.session import SessionLocal
from app.main import app
from app.services.quiz import question_to_schema


@pytest.fixture(autouse=True)
def avoid_duden_meaning_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.words._get_duden_meaning_overview", lambda word: None)


def test_player_cookie_is_idempotent() -> None:
    with TestClient(app) as client:
        first = client.get("/api/players/me")
        second = client.get("/api/players/me")

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["player_id"] == second.json()["player_id"]


def test_spa_html_is_not_cached_across_deploys() -> None:
    with TestClient(app) as client:
        response = client.get("/")

        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"


def test_endless_attempt_finishes_on_wrong_answer() -> None:
    with TestClient(app) as client:
        client.get("/api/players/me")
        started = client.post("/api/quiz/endless/start")
        assert started.status_code == 200

        payload = started.json()
        question = payload["question"]
        db = SessionLocal()
        try:
            stored_question = db.get(QuizAttemptQuestion, question["question_id"])
            assert stored_question is not None
            wrong_answer = next(
                choice for choice in question["choices"] if choice != stored_question.correct_answer
            )
        finally:
            db.close()

        answered = client.post(
            "/api/quiz/endless/answer",
            json={
                "attempt_id": payload["attempt_id"],
                "question_id": question["question_id"],
                "selected_answer": wrong_answer,
            },
        )

        assert answered.status_code == 200
        assert answered.json()["attempt_finished"] is True


def test_endless_answer_returns_duden_meaning_overview(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.words._get_duden_meaning_overview",
        lambda word: "Gebäude, das Menschen zum Wohnen dient.",
    )

    with TestClient(app) as client:
        client.get("/api/players/me")
        started = client.post("/api/quiz/endless/start")
        assert started.status_code == 200

        payload = started.json()
        question = payload["question"]
        db = SessionLocal()
        try:
            stored_question = db.get(QuizAttemptQuestion, question["question_id"])
            assert stored_question is not None
            correct_answer = stored_question.correct_answer
            answered_word = stored_question.word
        finally:
            db.close()

        answered = client.post(
            "/api/quiz/endless/answer",
            json={
                "attempt_id": payload["attempt_id"],
                "question_id": question["question_id"],
                "selected_answer": correct_answer,
            },
        )

        assert answered.status_code == 200
        body = answered.json()
        assert body["correct"] is True
        assert body["answered_word"] == answered_word
        assert body["meaning_overview"] == "Gebäude, das Menschen zum Wohnen dient."


def test_endless_answer_handles_missing_duden_meaning_overview() -> None:
    with TestClient(app) as client:
        client.get("/api/players/me")
        started = client.post("/api/quiz/endless/start")
        assert started.status_code == 200

        payload = started.json()
        question = payload["question"]
        db = SessionLocal()
        try:
            stored_question = db.get(QuizAttemptQuestion, question["question_id"])
            assert stored_question is not None
            wrong_answer = next(
                choice for choice in question["choices"] if choice != stored_question.correct_answer
            )
        finally:
            db.close()

        answered = client.post(
            "/api/quiz/endless/answer",
            json={
                "attempt_id": payload["attempt_id"],
                "question_id": question["question_id"],
                "selected_answer": wrong_answer,
            },
        )

        assert answered.status_code == 200
        body = answered.json()
        assert body["correct"] is False
        assert body["attempt_finished"] is True
        assert body["meaning_overview"] == "No Duden meaning overview is available yet."


def test_leaderboard_endpoint_returns_list() -> None:
    with TestClient(app) as client:
        response = client.get("/api/leaderboard")

        assert response.status_code == 200
        assert isinstance(response.json(), list)


def test_zero_score_attempt_is_not_listed_on_leaderboard() -> None:
    with TestClient(app) as client:
        player = client.get("/api/players/me").json()
        started = client.post("/api/quiz/endless/start")
        assert started.status_code == 200

        payload = started.json()
        question = payload["question"]
        db = SessionLocal()
        try:
            stored_question = db.get(QuizAttemptQuestion, question["question_id"])
            assert stored_question is not None
            wrong_answer = next(
                choice for choice in question["choices"] if choice != stored_question.correct_answer
            )
        finally:
            db.close()

        answered = client.post(
            "/api/quiz/endless/answer",
            json={
                "attempt_id": payload["attempt_id"],
                "question_id": question["question_id"],
                "selected_answer": wrong_answer,
            },
        )
        assert answered.status_code == 200
        assert answered.json()["score"] == 0

        leaderboard = client.get("/api/leaderboard").json()
        own_entry = next(
            (entry for entry in leaderboard if entry["display_name"] == player["display_name"]),
            None,
        )
        assert own_entry is None


def test_leaderboard_includes_current_player_rank_beyond_visible_limit() -> None:
    with TestClient(app) as client:
        current_player = client.get("/api/players/me").json()
        name_suffix = uuid4().hex[:8]
        db = SessionLocal()
        try:
            current = db.get(AnonymousPlayer, current_player["player_id"])
            assert current is not None
            current_attempt = QuizAttempt(
                player_id=current.id,
                mode="endless",
                status="finished",
                score=1,
                total_questions=1,
                accuracy=1,
                ended_at=utc_now(),
                ended_reason="wrong_answer",
            )
            db.add(current_attempt)
            for index in range(6):
                player = AnonymousPlayer(display_name=f"RankedPlayer{name_suffix}{index}")
                db.add(player)
                db.flush()
                db.add(
                    QuizAttempt(
                        player_id=player.id,
                        mode="endless",
                        status="finished",
                        score=10 - index,
                        total_questions=10 - index,
                        accuracy=1,
                        ended_at=utc_now(),
                        ended_reason="wrong_answer",
                    )
                )
            db.commit()
        finally:
            db.close()

        leaderboard = client.get("/api/leaderboard?limit=5").json()

        assert len(leaderboard) == 6
        assert leaderboard[-1]["display_name"] == current_player["display_name"]
        assert leaderboard[-1]["rank"] > 5
        assert leaderboard[-1]["is_current_player"] is True
        assert all(entry["is_current_player"] is False for entry in leaderboard[:-1])


def test_word_of_day_endpoint_returns_duden_word(monkeypatch) -> None:
    class FakeDudenWord:
        name = "Crush"
        article = "der"
        part_of_speech = "Substantiv, maskulin"
        meaning_overview: ClassVar[list[str]] = ["Person, in die jemand verliebt ist"]

    monkeypatch.setattr(
        "app.services.words.duden.get_word_of_the_day",
        lambda: FakeDudenWord(),
    )

    with TestClient(app) as client:
        response = client.get("/api/word-of-the-day")

        assert response.status_code == 200
        body = response.json()
        assert body["word"] == "Crush"
        assert body["article"] == "der"
        assert body["part_of_speech"] == "Substantiv, maskulin"
        assert body["meaning"] == "Person, in die jemand verliebt ist"
        assert body["date"]


def test_focus_levels_are_loaded_from_csv() -> None:
    with TestClient(app) as client:
        response = client.get("/api/focus/levels")

        assert response.status_code == 200
        body = response.json()
        assert body == [
            {"level": "A1", "word_count": 60, "topic_count": 6},
            {"level": "A2", "word_count": 50, "topic_count": 5},
            {"level": "B1", "word_count": 50, "topic_count": 5},
            {"level": "B2", "word_count": 20, "topic_count": 2},
        ]


def test_focus_topics_are_filtered_by_level() -> None:
    with TestClient(app) as client:
        response = client.get("/api/focus/topics?level=A1")

        assert response.status_code == 200
        topics = response.json()
        assert {"topic": "food_drink", "label": "Food & Drink", "word_count": 10} in topics
        assert {"topic": "work_career", "label": "Work & Career", "word_count": 10} not in topics


def test_focus_cards_are_filtered_by_level_and_topic() -> None:
    with TestClient(app) as client:
        response = client.get("/api/focus/cards?level=A1&topic=food_drink")

        assert response.status_code == 200
        cards = response.json()
        assert len(cards) == 10
        assert {card["topic"] for card in cards} == {"food_drink"}
        assert {card["level"] for card in cards} == {"A1"}
        bread = next(card for card in cards if card["word"] == "Brot")
        assert bread["article"] == "das"
        assert bread["part_of_speech"] == "noun"
        assert bread["meaning_overview"] == "bread"


def test_leaderboard_question_count_matches_best_streak_not_final_miss() -> None:
    with TestClient(app) as client:
        player = client.get("/api/players/me").json()
        started = client.post("/api/quiz/endless/start")
        assert started.status_code == 200

        payload = started.json()
        attempt_id = payload["attempt_id"]
        question = payload["question"]

        for _ in range(7):
            db = SessionLocal()
            try:
                stored_question = db.get(QuizAttemptQuestion, question["question_id"])
                assert stored_question is not None
                answer = stored_question.correct_answer
            finally:
                db.close()

            answered = client.post(
                "/api/quiz/endless/answer",
                json={
                    "attempt_id": attempt_id,
                    "question_id": question["question_id"],
                    "selected_answer": answer,
                },
            )
            assert answered.status_code == 200
            body = answered.json()
            assert body["score"] == _ + 1
            question = body["next_question"]
            assert question is not None

        db = SessionLocal()
        try:
            stored_question = db.get(QuizAttemptQuestion, question["question_id"])
            assert stored_question is not None
            wrong_answer = next(
                choice for choice in question["choices"] if choice != stored_question.correct_answer
            )
        finally:
            db.close()

        answered = client.post(
            "/api/quiz/endless/answer",
            json={
                "attempt_id": attempt_id,
                "question_id": question["question_id"],
                "selected_answer": wrong_answer,
            },
        )
        assert answered.status_code == 200
        assert answered.json()["score"] == 7

        leaderboard = client.get("/api/leaderboard").json()
        own_entry = next(
            entry for entry in leaderboard if entry["display_name"] == player["display_name"]
        )
        assert own_entry["score"] == 7
        assert own_entry["total_questions"] == 7


def test_player_best_endless_score_only_increases() -> None:
    with TestClient(app) as client:
        player = client.get("/api/players/me").json()
        assert player["best_endless_score"] == 0

        _finish_endless_run(client, correct_count=2)
        assert client.get("/api/players/me").json()["best_endless_score"] == 2

        _finish_endless_run(client, correct_count=1)
        assert client.get("/api/players/me").json()["best_endless_score"] == 2


def _finish_endless_run(client: TestClient, correct_count: int) -> None:
    started = client.post("/api/quiz/endless/start")
    assert started.status_code == 200

    payload = started.json()
    attempt_id = payload["attempt_id"]
    question = payload["question"]

    for _ in range(correct_count):
        db = SessionLocal()
        try:
            stored_question = db.get(QuizAttemptQuestion, question["question_id"])
            assert stored_question is not None
            correct_answer = stored_question.correct_answer
        finally:
            db.close()

        answered = client.post(
            "/api/quiz/endless/answer",
            json={
                "attempt_id": attempt_id,
                "question_id": question["question_id"],
                "selected_answer": correct_answer,
            },
        )
        assert answered.status_code == 200
        body = answered.json()
        question = body["next_question"]
        assert question is not None

    db = SessionLocal()
    try:
        stored_question = db.get(QuizAttemptQuestion, question["question_id"])
        assert stored_question is not None
        wrong_answer = next(
            choice for choice in question["choices"] if choice != stored_question.correct_answer
        )
    finally:
        db.close()

    answered = client.post(
        "/api/quiz/endless/answer",
        json={
            "attempt_id": attempt_id,
            "question_id": question["question_id"],
            "selected_answer": wrong_answer,
        },
    )
    assert answered.status_code == 200
    assert answered.json()["score"] == correct_count


def test_practice_mode_continues_after_wrong_answer() -> None:
    with TestClient(app) as client:
        client.get("/api/players/me")
        started = client.post("/api/quiz/practice/start")
        assert started.status_code == 200

        payload = started.json()
        question = payload["question"]
        db = SessionLocal()
        try:
            stored_question = db.get(QuizAttemptQuestion, question["question_id"])
            assert stored_question is not None
            wrong_answer = next(
                choice for choice in question["choices"] if choice != stored_question.correct_answer
            )
        finally:
            db.close()

        answered = client.post(
            "/api/quiz/practice/answer",
            json={
                "attempt_id": payload["attempt_id"],
                "question_id": question["question_id"],
                "selected_answer": wrong_answer,
            },
        )

        assert answered.status_code == 200
        body = answered.json()
        assert body["correct"] is False
        assert body["score"] == 0
        assert body["total_questions"] == 1
        assert body["next_question"] is not None


def test_timed_mode_start_returns_duration() -> None:
    with TestClient(app) as client:
        client.get("/api/players/me")
        started = client.post("/api/quiz/timed/start")

        assert started.status_code == 200
        body = started.json()
        assert body["duration_seconds"] == 60
        assert body["score"] == 0
        assert body["total_questions"] == 0
        assert body["question"] is not None


def test_word_type_noun_question_displays_lowercase_word() -> None:
    question = QuizAttemptQuestion(
        id="question-id",
        attempt_id="attempt-id",
        word="Haus",
        question_type="word_type",
        prompt="What type of word is 'haus'?",
        correct_answer="noun",
        choices_json=json.dumps(["noun", "verb", "adjective", "adverb"]),
    )

    payload = question_to_schema(question)

    assert payload.word == "haus"
    assert payload.prompt == "What type of word is 'haus'?"


def test_new_attempt_for_same_player_prefers_unseen_first_question() -> None:
    with TestClient(app) as client:
        client.get("/api/players/me")

        first = client.post("/api/quiz/practice/start")
        second = client.post("/api/quiz/practice/start")

        assert first.status_code == 200
        assert second.status_code == 200
        first_question = first.json()["question"]
        second_question = second.json()["question"]
        assert (second_question["word"], second_question["type"]) != (
            first_question["word"],
            first_question["type"],
        )


def test_endless_questions_do_not_repeat_before_pool_is_exhausted() -> None:
    with TestClient(app) as client:
        client.get("/api/players/me")
        started = client.post("/api/quiz/endless/start")
        assert started.status_code == 200

        payload = started.json()
        attempt_id = payload["attempt_id"]
        question = payload["question"]
        seen = {(question["word"], question["type"])}

        for _ in range(10):
            db = SessionLocal()
            try:
                stored_question = db.get(QuizAttemptQuestion, question["question_id"])
                assert stored_question is not None
                correct_answer = stored_question.correct_answer
            finally:
                db.close()

            answered = client.post(
                "/api/quiz/endless/answer",
                json={
                    "attempt_id": attempt_id,
                    "question_id": question["question_id"],
                    "selected_answer": correct_answer,
                },
            )
            assert answered.status_code == 200
            body = answered.json()
            assert body["correct"] is True
            question = body["next_question"]
            assert question is not None

            pair = (question["word"], question["type"])
            assert pair not in seen
            seen.add(pair)
