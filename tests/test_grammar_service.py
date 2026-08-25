from typing import Any

from app.services import grammar


class CapturingDb:
    class Bind:
        class Dialect:
            name = "postgresql"

        dialect = Dialect()

    bind = Bind()

    def __init__(self) -> None:
        self.params: dict[str, Any] | None = None
        self.sql = ""

    def execute(self, statement: Any, params: dict[str, Any]) -> Any:
        self.sql = str(statement)
        self.params = params
        return Result()


class Result:
    def mappings(self) -> list[dict[str, Any]]:
        return [
            {
                "id": "artikel-kasus-dativ-articles",
                "title": "Artikel Kasus",
                "section": "Dativ Articles",
                "content": "der becomes dem in Dativ.",
                "level": "A1",
                "topic": "artikel_kasus",
                "source_path": "data/grammar/articles-cases.md",
                "source_kind": "markdown",
                "page_start": None,
                "page_end": None,
                "similarity": 0.82,
            }
        ]


def test_retrieve_grammar_chunks_is_global_semantic_search() -> None:
    db = CapturingDb()

    citations = grammar.retrieve_grammar_chunks(db, [0.1, 0.2])

    assert len(citations) == 1
    assert db.params == {"embedding": "[0.10000000,0.20000000]"}
    assert "where level" not in db.sql.casefold()
    assert "topic_boost" not in db.sql
    assert "order by embedding <=>" in db.sql.casefold()


def test_generate_answer_prompt_has_no_derived_level(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def fake_post_json(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: int) -> dict[str, Any]:
        captured["payload"] = payload
        return {"choices": [{"message": {"content": "Use Dativ: einem guten Freund."}}]}

    monkeypatch.setattr(grammar, "_post_json", fake_post_json)
    settings = grammar.Settings(cohere_api_key="cohere", openrouter_api_key="openrouter")
    citation = grammar.GrammarCitation(
        chunk_id="artikel-kasus-dativ-articles",
        title="Artikel Kasus",
        section="Dativ Articles",
        content="der becomes dem in Dativ.",
        level="A1",
        topic="artikel_kasus",
        similarity=0.82,
        source_path="data/grammar/articles-cases.md",
    )

    answer = grammar.generate_answer(
        question="warum einem guten Freund?",
        citations=[citation],
        settings=settings,
    )

    assert answer == "Use Dativ: einem guten Freund."
    messages = captured["payload"]["messages"]
    assert "Answer in the language the learner asked in" in messages[0]["content"]
    assert "Learner level" not in messages[1]["content"]
