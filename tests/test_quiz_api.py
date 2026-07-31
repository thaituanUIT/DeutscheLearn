from fastapi.testclient import TestClient

from app.db.models import QuizAttemptQuestion
from app.db.session import SessionLocal
from app.main import app


def test_player_cookie_is_idempotent() -> None:
    with TestClient(app) as client:
        first = client.get("/api/players/me")
        second = client.get("/api/players/me")

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["player_id"] == second.json()["player_id"]


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


def test_leaderboard_endpoint_returns_list() -> None:
    with TestClient(app) as client:
        response = client.get("/api/leaderboard")

        assert response.status_code == 200
        assert isinstance(response.json(), list)
