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
                "keyword_score": 0.12,
                "hybrid_score": 0.61,
            }
        ]


def test_retrieve_grammar_chunks_uses_lightweight_hybrid_ranking() -> None:
    db = CapturingDb()

    citations = grammar.retrieve_grammar_chunks(db, [0.1, 0.2], query_text="mit dem Auto")

    assert len(citations) == 1
    assert db.params == {"embedding": "[0.10000000,0.20000000]", "query_text": "mit dem Auto"}
    assert "where level" not in db.sql.casefold()
    assert "plainto_tsquery('simple', :query_text)" in db.sql
    assert "keyword_score" in db.sql
    assert "hybrid_score" in db.sql
    assert "order by hybrid_score desc" in db.sql.casefold()
    assert citations[0].similarity == 0.82
    assert citations[0].keyword_score == 0.12
    assert citations[0].hybrid_score == 0.61


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
