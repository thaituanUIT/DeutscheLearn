import json
from typing import ClassVar
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.core.time import utc_now
from app.db.models import (
    AnonymousPlayer,
    CachedWord,
    FocusWordEntry,
    QuizAttempt,
    QuizAttemptQuestion,
    ReadingAnswer,
    ReadingPassage,
    ReadingQuestion,
    Topic,
)
from app.db.session import SessionLocal
from app.main import app
from app.services.focus import import_focus_words
from app.services.grammar import GrammarAnswer, GrammarCitation
from app.services.quiz import question_to_schema
from app.services.words import get_meaning_overview


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


def test_grammar_ask_returns_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    citation = GrammarCitation(
        chunk_id="prep-dativ-mit",
        title="Dative Prepositions",
        section="Why mit dem Auto",
        content="mit always takes Dativ.",
        level="A2",
        topic="praeposition_dativ",
        similarity=0.88,
        source_path="data/grammar/prepositions-dativ.md",
    )

    def fake_answer(**kwargs) -> GrammarAnswer:
        assert kwargs["level"] == "A2"
        assert kwargs["topic"] == "praeposition_dativ"
        assert kwargs["include_debug"] is False
        return GrammarAnswer(status="answered", answer="Use Dativ after mit.", citations=[citation])

    monkeypatch.setattr("app.api.routes.check_rate_limit", lambda learner_id, ip: None)
    monkeypatch.setattr("app.api.routes.answer_grammar_question", fake_answer)

    with TestClient(app) as client:
        response = client.post(
            "/api/grammar/ask",
            json={
                "question": "Why mit dem Auto?",
                "level": "A2",
                "topic": "praeposition_dativ",
                "learner_id": "learner-1",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "answered"
    assert body["answer"] == "Use Dativ after mit."
    assert body["citations"][0]["chunk_id"] == "prep-dativ-mit"


def test_grammar_ask_debug_requires_admin_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.routes.get_settings", lambda: Settings(admin_token="secret"))
    monkeypatch.setattr("app.api.routes.check_rate_limit", lambda learner_id, ip: None)

    seen_debug: list[bool] = []

    def fake_answer(**kwargs) -> GrammarAnswer:
        seen_debug.append(kwargs["include_debug"])
        return GrammarAnswer(
            status="no_match",
            answer=None,
            citations=[],
            retrieval_debug={"retrieved": []} if kwargs["include_debug"] else None,
        )

    monkeypatch.setattr("app.api.routes.answer_grammar_question", fake_answer)

    with TestClient(app) as client:
        no_admin = client.post(
            "/api/grammar/ask",
            json={"question": "unknown", "level": "A1", "include_debug": True},
        )
        admin = client.post(
            "/api/grammar/ask",
            headers={"Authorization": "Bearer secret"},
            json={"question": "unknown", "level": "A1", "include_debug": True},
        )

    assert no_admin.status_code == 200
    assert no_admin.json()["retrieval_debug"] is None
    assert admin.status_code == 200
    assert admin.json()["retrieval_debug"] == {"retrieved": []}
    assert seen_debug == [False, True]


def test_grammar_ask_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_rate_limit(learner_id: str | None, ip: str) -> None:
        raise PermissionError("rate_limited")

    monkeypatch.setattr("app.api.routes.check_rate_limit", fake_rate_limit)

    with TestClient(app) as client:
        response = client.post(
            "/api/grammar/ask",
            json={"question": "Why?", "level": "A1", "learner_id": "learner-1"},
        )

    assert response.status_code == 429


def test_admin_words_require_valid_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.routes.get_settings", lambda: Settings(admin_token="secret"))

    with TestClient(app) as client:
        missing = client.get("/api/admin/words")
        invalid = client.get("/api/admin/words", headers={"Authorization": "Bearer wrong"})

        assert missing.status_code == 401
        assert invalid.status_code == 401


def test_admin_word_crud(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.routes.get_settings", lambda: Settings(admin_token="secret"))
    word = f"Adminwort-{uuid4()}"
    headers = {"Authorization": "Bearer secret"}

    with TestClient(app) as client:
        created = client.post(
            "/api/admin/words",
            headers=headers,
            json={
                "word": word,
                "article": "das",
                "part_of_speech": "noun",
                "meaning": "A word managed from the admin interface.",
                "focus_entries": [{"level": "A1", "topic": "food_drink"}],
            },
        )
        assert created.status_code == 200
        assert created.json()["focus_entries"][0]["topic"] == "food_drink"

        updated = client.patch(
            f"/api/admin/words/{word}",
            headers=headers,
            json={
                "article": None,
                "part_of_speech": "verb",
                "meaning": "Updated meaning.",
                "focus_entries": [{"level": "A2", "topic": "travel_transport"}],
            },
        )
        assert updated.status_code == 200
        assert updated.json()["part_of_speech"] == "verb"
        assert updated.json()["focus_entries"][0]["level"] == "A2"

        deleted = client.delete(f"/api/admin/words/{word}", headers=headers)
        assert deleted.status_code == 204


def test_admin_word_rejects_unknown_focus_topic(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.routes.get_settings", lambda: Settings(admin_token="secret"))
    word = f"InvalidTopic-{uuid4()}"
    headers = {"Authorization": "Bearer secret"}

    with TestClient(app) as client:
        rejected = client.post(
            "/api/admin/words",
            headers=headers,
            json={
                "word": word,
                "article": "das",
                "part_of_speech": "noun",
                "meaning": "A word with an invalid focus topic.",
                "focus_entries": [{"level": "A1", "topic": "food_drinks"}],
            },
        )

        assert rejected.status_code == 422
        assert "Unknown focus topic: food_drinks" in rejected.json()["detail"]

    db = SessionLocal()
    try:
        assert db.scalar(select(CachedWord).where(CachedWord.lemma == word)) is None
        assert (
            db.query(FocusWordEntry)
            .join(CachedWord)
            .join(Topic)
            .filter(CachedWord.lemma == word, Topic.slug == "food_drinks")
            .first()
            is None
        )
    finally:
        db.close()


def test_admin_word_rejects_unknown_focus_topic_without_replacing_existing_entries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.api.routes.get_settings", lambda: Settings(admin_token="secret"))
    word = f"PreserveTopic-{uuid4()}"
    headers = {"Authorization": "Bearer secret"}

    with TestClient(app) as client:
        created = client.post(
            "/api/admin/words",
            headers=headers,
            json={
                "word": word,
                "article": "das",
                "part_of_speech": "noun",
                "meaning": "A word with a valid existing focus topic.",
                "focus_entries": [{"level": "A1", "topic": "food_drink"}],
            },
        )
        assert created.status_code == 200

        rejected = client.patch(
            f"/api/admin/words/{word}",
            headers=headers,
            json={
                "article": "das",
                "part_of_speech": "noun",
                "meaning": "This update should be rejected.",
                "focus_entries": [{"level": "A1", "topic": "food_drinks"}],
            },
        )

        assert rejected.status_code == 422

    db = SessionLocal()
    try:
        entries = (
            db.query(FocusWordEntry)
            .join(CachedWord)
            .join(Topic)
            .filter(CachedWord.lemma == word)
            .all()
        )
        assert [(entry.level, entry.topic.slug) for entry in entries] == [("A1", "food_drink")]
    finally:
        db.close()


def test_focus_seed_import_preserves_admin_focus_entries(tmp_path) -> None:
    admin_word = f"AdminSeed-{uuid4()}"
    csv_word = f"CsvSeed-{uuid4()}"
    csv_path = tmp_path / "focus_words.csv"
    csv_path.write_text(
        "\n".join(
            [
                "word,topic,level,article,part_of_speech,meaning",
                f"{csv_word},food_drink,A1,das,noun,A word from the seed file.",
            ]
        ),
        encoding="utf-8",
    )

    db = SessionLocal()
    try:
        db.add(
            CachedWord(
                word=admin_word,
                article="das",
                part_of_speech="noun",
                meaning="A word created through the admin interface.",
            )
        )
        db.flush()
        topic = db.scalar(select(Topic).where(Topic.slug == "travel_transport"))
        if topic is None:
            topic = Topic(slug="travel_transport", name="Travel & Transport")
            db.add(topic)
            db.flush()
        stored_word = db.scalar(select(CachedWord).where(CachedWord.lemma == admin_word))
        assert stored_word is not None
        db.add(FocusWordEntry(word_id=stored_word.id, level="A2", topic_id=topic.id))
        db.commit()

        import_focus_words(db, csv_path)

        admin_entries = (
            db.query(FocusWordEntry)
            .join(CachedWord)
            .join(Topic)
            .filter(CachedWord.lemma == admin_word)
            .all()
        )
        csv_entries = (
            db.query(FocusWordEntry)
            .join(CachedWord)
            .join(Topic)
            .filter(CachedWord.lemma == csv_word)
            .all()
        )
        assert [(entry.level, entry.topic.slug) for entry in admin_entries] == [
            ("A2", "travel_transport")
        ]
        assert [(entry.level, entry.topic.slug) for entry in csv_entries] == [("A1", "food_drink")]
    finally:
        db.close()


def test_admin_reading_passage_crud(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.routes.get_settings", lambda: Settings(admin_token="secret"))
    headers = {"Authorization": "Bearer secret"}

    payload = {
        "level": "A1",
        "topic": "daily_life",
        "title": f"Admin Passage {uuid4()}",
        "passage_text": "Mia liest am Morgen ein Buch.",
        "order_index": 1,
        "questions": [
            {
                "prompt": "Wann liest Mia?",
                "explanation": "The passage says am Morgen.",
                "order_index": 0,
                "answers": [
                    {"answer_text": "Am Morgen", "is_correct": True, "order_index": 0},
                    {"answer_text": "Am Abend", "is_correct": False, "order_index": 1},
                ],
            }
        ],
    }

    with TestClient(app) as client:
        created = client.post("/api/admin/reading/passages", headers=headers, json=payload)
        assert created.status_code == 200
        passage_id = created.json()["id"]
        assert created.json()["questions"][0]["answers"][0]["is_correct"] is True

        listed = client.get("/api/admin/reading/passages?level=A1", headers=headers)
        assert listed.status_code == 200
        assert any(passage["id"] == passage_id for passage in listed.json())

        payload["title"] = "Updated Admin Passage"
        updated = client.patch(
            f"/api/admin/reading/passages/{passage_id}",
            headers=headers,
            json=payload,
        )
        assert updated.status_code == 200
        assert updated.json()["title"] == "Updated Admin Passage"

        deleted = client.delete(f"/api/admin/reading/passages/{passage_id}", headers=headers)
        assert deleted.status_code == 204


def test_story_mode_lists_passages_without_exposing_correct_answers() -> None:
    passage_title = f"Story Passage {uuid4()}"
    db = SessionLocal()
    try:
        passage = ReadingPassage(
            level="A1",
            topic="daily_life",
            title=passage_title,
            passage_text="Tom kauft heute Brot.",
            questions=[
                ReadingQuestion(
                    prompt="Was kauft Tom?",
                    answers=[
                        ReadingAnswer(answer_text="Brot", is_correct=True, order_index=0),
                        ReadingAnswer(answer_text="Milch", is_correct=False, order_index=1),
                    ],
                )
            ],
        )
        db.add(passage)
        db.commit()
        passage_id = passage.id
    finally:
        db.close()

    with TestClient(app) as client:
        listed = client.get("/api/story/passages?level=A1")
        assert listed.status_code == 200
        assert any(item["id"] == passage_id for item in listed.json())

        detail = client.get(f"/api/story/passages/{passage_id}")
        assert detail.status_code == 200
        body = detail.json()
        assert body["title"] == passage_title
        assert "is_correct" not in body["questions"][0]["answers"][0]


def test_story_mode_exposes_general_and_goethe_structure() -> None:
    with TestClient(app) as client:
        groups = client.get("/api/story/groups")
        assert groups.status_code == 200
        groups_by_key = {group["group"]: group for group in groups.json()}
        assert groups_by_key["general"]["label"] == "General"
        assert groups_by_key["goethe"]["label"] == "Goethe-Institut"

        levels = client.get("/api/story/levels?group=goethe")
        assert levels.status_code == 200
        assert [level["level"] for level in levels.json()] == ["A1", "A2", "B1", "B2"]

        expected_parts = {
            "A1": ["teil_1", "teil_2", "teil_3"],
            "A2": ["teil_1", "teil_2", "teil_3", "teil_4"],
            "B1": ["teil_1", "teil_2", "teil_3", "teil_4", "teil_5"],
            "B2": ["teil_1", "teil_2", "teil_3", "teil_4", "teil_5"],
        }
        for level, expected in expected_parts.items():
            parts = client.get(f"/api/story/parts?level={level}")
            assert parts.status_code == 200
            assert [part["part"] for part in parts.json()] == expected


def test_story_passages_filter_by_group_level_and_part() -> None:
    db = SessionLocal()
    try:
        general = ReadingPassage(
            group="general",
            level="A1",
            topic="daily_life",
            title=f"General Story {uuid4()}",
            passage_text="Ein kurzer allgemeiner Text.",
        )
        goethe = ReadingPassage(
            group="goethe",
            level="A1",
            part="teil_3",
            topic="goethe_institut",
            title=f"Goethe Story {uuid4()}",
            passage_text="Ein kurzer Goethe-Text.",
        )
        db.add_all([general, goethe])
        db.commit()
        general_id = general.id
        goethe_id = goethe.id
    finally:
        db.close()

    with TestClient(app) as client:
        general_list = client.get("/api/story/passages?group=general&level=A1")
        assert general_list.status_code == 200
        general_ids = {item["id"] for item in general_list.json()}
        assert general_id in general_ids
        assert goethe_id not in general_ids

        goethe_list = client.get("/api/story/passages?group=goethe&level=A1&part=teil_3")
        assert goethe_list.status_code == 200
        goethe_ids = {item["id"] for item in goethe_list.json()}
        assert goethe_id in goethe_ids
        assert general_id not in goethe_ids


def test_story_answer_is_checked_server_side() -> None:
    db = SessionLocal()
    try:
        passage = ReadingPassage(
            level="A2",
            topic="food_drink",
            title=f"Story Answer {uuid4()}",
            passage_text="Nina trinkt Tee.",
            questions=[
                ReadingQuestion(
                    prompt="Was trinkt Nina?",
                    explanation="The story says Nina drinks tea.",
                    answers=[
                        ReadingAnswer(answer_text="Tee", is_correct=True, order_index=0),
                        ReadingAnswer(answer_text="Kaffee", is_correct=False, order_index=1),
                    ],
                )
            ],
        )
        db.add(passage)
        db.commit()
        question = passage.questions[0]
        correct = next(answer for answer in question.answers if answer.is_correct)
        wrong = next(answer for answer in question.answers if not answer.is_correct)
        question_id = question.id
        correct_id = correct.id
        wrong_id = wrong.id
    finally:
        db.close()

    with TestClient(app) as client:
        answered = client.post(
            "/api/story/answer",
            json={"question_id": question_id, "answer_id": wrong_id},
        )

        assert answered.status_code == 200
        body = answered.json()
        assert body["correct"] is False
        assert body["correct_answer_id"] == correct_id
        assert body["correct_answer_text"] == "Tee"
        assert body["explanation"] == "The story says Nina drinks tea."


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


def test_endless_answer_returns_cached_meaning_overview(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.words._get_duden_meaning_overview",
        lambda word: "Duden should not be called for cached quiz words.",
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
            cached_word = db.scalar(select(CachedWord).where(CachedWord.lemma == answered_word))
            assert cached_word is not None
            expected_meaning = cached_word.meaning
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
        assert body["meaning_overview"] == expected_meaning


def test_meaning_overview_falls_back_to_duden_for_uncached_word(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.words._get_duden_meaning_overview",
        lambda word: "Duden fallback meaning.",
    )

    db = SessionLocal()
    try:
        assert db.scalar(select(CachedWord).where(CachedWord.lemma == "NichtImCache")) is None
        assert get_meaning_overview(db, "NichtImCache") == "Duden fallback meaning."
    finally:
        db.close()


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
        db = SessionLocal()
        try:
            cached_word = db.scalar(select(CachedWord).where(CachedWord.lemma == body["answered_word"]))
            assert cached_word is not None
            assert body["meaning_overview"] == cached_word.meaning
        finally:
            db.close()


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
        counts_by_level = {level["level"]: level for level in body}
        assert counts_by_level["A1"]["word_count"] >= 82
        assert counts_by_level["A1"]["topic_count"] >= 6
        assert counts_by_level["A2"]["word_count"] >= 72
        assert counts_by_level["A2"]["topic_count"] >= 5
        assert counts_by_level["B1"]["word_count"] >= 68
        assert counts_by_level["B1"]["topic_count"] >= 5
        assert counts_by_level["B2"]["word_count"] >= 32
        assert counts_by_level["B2"]["topic_count"] >= 2


def test_focus_topics_are_filtered_by_level() -> None:
    with TestClient(app) as client:
        response = client.get("/api/focus/topics?level=A1")

        assert response.status_code == 200
        topics = response.json()
        topics_by_key = {topic["topic"]: topic for topic in topics}
        assert topics_by_key["food_drink"]["label"] == "Food & Drink"
        assert topics_by_key["food_drink"]["word_count"] >= 14
        assert "work_career" not in topics_by_key


def test_focus_topic_aliases_return_allowed_topic_keys() -> None:
    with TestClient(app) as client:
        response = client.get("/api/focus/topic-aliases")

        assert response.status_code == 200
        topics = response.json()
        assert {"topic": "food_drink", "label": "Food & Drink"} in topics
        assert {"topic": "travel_transport", "label": "Travel & Transport"} in topics
        assert all("word_count" not in topic for topic in topics)


def test_focus_cards_are_filtered_by_level_and_topic() -> None:
    with TestClient(app) as client:
        response = client.get("/api/focus/cards?level=A1&topic=food_drink")

        assert response.status_code == 200
        cards = response.json()
        assert len(cards) >= 14
        assert {card["topic"] for card in cards} == {"food_drink"}
        assert {card["level"] for card in cards} == {"A1"}
        bread = next(card for card in cards if card["word"] == "Brot")
        assert bread["article"] == "das"
        assert bread["part_of_speech"] == "noun"
        assert bread["meaning_overview"] == "bread"
        studentenfutter = next(card for card in cards if card["word"] == "Studentenfutter")
        assert studentenfutter["article"] == "das"
        assert studentenfutter["part_of_speech"] == "noun"
        assert studentenfutter["meaning_overview"] == "trail mix made from nuts and dried fruit"


def test_focus_revision_returns_stateless_topic_quiz() -> None:
    db = SessionLocal()
    try:
        before_attempts = len(db.query(QuizAttempt).all())
    finally:
        db.close()

    with TestClient(app) as client:
        response = client.get("/api/focus/revision?level=A1&topic=food_drink")

        assert response.status_code == 200
        questions = response.json()
        assert len(questions) == 5
        assert {question["topic"] for question in questions} == {"food_drink"}
        assert {question["level"] for question in questions} == {"A1"}
        for question in questions:
            assert len(question["choices"]) == 3
            assert question["correct_answer"] in question["choices"]
            assert question["meaning_overview"] == question["correct_answer"]

    db = SessionLocal()
    try:
        after_attempts = len(db.query(QuizAttempt).all())
    finally:
        db.close()
    assert after_attempts == before_attempts


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
