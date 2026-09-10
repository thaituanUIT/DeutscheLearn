from typing import Any
from urllib.error import HTTPError, URLError

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
                "content_hash": "hash-dativ-articles",
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


def test_assess_query_quality_rejects_single_term_but_allows_short_question() -> None:
    assert not grammar.assess_query_quality("akkusativ")["retrievable"]
    assert grammar.assess_query_quality("what is akkusativ articles")["retrievable"]
    assert grammar.clarification_prompt("akkusativ") == "What would you like to know about the Akkusativ?"


def test_answer_grammar_question_rejects_vague_query_before_embedding(monkeypatch) -> None:
    def fail_embed(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("Short queries should not go to retrieval")

    monkeypatch.setattr(grammar, "embed_texts", fail_embed)

    answer = grammar.answer_grammar_question(
        db=CapturingDb(),  # type: ignore[arg-type]
        question="akkusativ",
        include_debug=True,
        settings=grammar.Settings(cohere_api_key="cohere", openrouter_api_key="openrouter"),
    )

    assert answer.status == "no_match"
    assert answer.answer == "What would you like to know about the Akkusativ?"
    assert answer.citations == []
    assert answer.retrieval_debug == {
        "query": {
            "retrievable": False,
            "word_count": 1,
            "content_word_count": 1,
            "min_query_words": 3,
            "reason": "too_short_or_vague",
        },
    }


def test_filter_grammar_chunks_uses_absolute_and_relative_floors() -> None:
    chunks = [
        grammar.GrammarCitation(
            chunk_id="akkusativ",
            title="Articles and Cases",
            section="Nominativ and Akkusativ",
            content="Akkusativ masculine der becomes den.",
            level="A1",
            topic="artikel_kasus",
            similarity=0.90,
            source_path="data/grammar/articles-cases.md",
        ),
        grammar.GrammarCitation(
            chunk_id="dativ-neighbor",
            title="Articles and Cases",
            section="Dativ Articles",
            content="Dativ masculine der becomes dem.",
            level="A1",
            topic="artikel_kasus",
            similarity=0.70,
            source_path="data/grammar/articles-cases.md",
        ),
        grammar.GrammarCitation(
            chunk_id="weak",
            title="Perfect Tense",
            section="Past Participle",
            content="Regular participles use ge plus stem plus t.",
            level="A2",
            topic="perfekt",
            similarity=0.30,
            source_path="data/grammar/perfect-tense.md",
        ),
    ]

    accepted, debug = grammar.filter_grammar_chunks(
        chunks,
        settings=grammar.Settings(
            grammar_similarity_threshold=0.40,
            grammar_relative_similarity_threshold=0.85,
        ),
    )

    assert [chunk.chunk_id for chunk in accepted] == ["akkusativ"]
    assert debug["top_score"] == 0.90
    removed = {chunk["chunk_id"]: chunk["removed_by"] for chunk in debug["chunks"]}
    assert removed == {
        "akkusativ": None,
        "dativ-neighbor": "relative_floor",
        "weak": "absolute_floor",
    }


def test_filter_grammar_chunks_deduplicates_near_identical_content() -> None:
    chunks = [
        grammar.GrammarCitation(
            chunk_id="one",
            title="Articles and Cases",
            section="Akkusativ",
            content="Akkusativ masculine article der changes to den for the direct object.",
            level="A1",
            topic="artikel_kasus",
            similarity=0.90,
            source_path="data/grammar/articles-cases.md",
        ),
        grammar.GrammarCitation(
            chunk_id="two",
            title="Articles and Cases",
            section="Akkusativ Examples",
            content="Akkusativ masculine article der changes to den for the direct object in examples.",
            level="A1",
            topic="artikel_kasus",
            similarity=0.89,
            source_path="data/grammar/articles-cases.md",
        ),
    ]

    accepted, debug = grammar.filter_grammar_chunks(chunks)

    assert [chunk.chunk_id for chunk in accepted] == ["one"]
    assert debug["chunks"][1]["removed_by"] == "duplicate"


def test_filter_grammar_chunks_drops_conflicting_case_chunks() -> None:
    chunks = [
        grammar.GrammarCitation(
            chunk_id="akkusativ",
            title="Articles and Cases",
            section="Nominativ and Akkusativ",
            content="Akkusativ masculine article der changes to den.",
            level="A1",
            topic="artikel_kasus",
            similarity=0.55,
            source_path="data/grammar/articles-cases.md",
        ),
        grammar.GrammarCitation(
            chunk_id="dativ",
            title="Articles and Cases",
            section="Dativ Articles",
            content="Dativ masculine article der changes to dem.",
            level="A1",
            topic="artikel_kasus",
            similarity=0.50,
            source_path="data/grammar/articles-cases.md",
        ),
    ]

    accepted, debug = grammar.filter_grammar_chunks(
        chunks,
        query_text="what is akkusativ articles",
    )

    assert [chunk.chunk_id for chunk in accepted] == ["akkusativ"]
    assert debug["chunks"][1]["removed_by"] == "conflicting_case_term"


def test_generate_answer_prompt_has_no_derived_level(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def fake_post_json(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: int) -> dict[str, Any]:
        captured["payload"] = payload
        return {"choices": [{"message": {"content": "Use Dativ: einem guten Freund."}, "finish_reason": "stop"}]}

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

    answer, finish_reason = grammar.generate_answer(
        question="warum einem guten Freund?",
        citations=[citation],
        settings=settings,
    )

    assert answer == "Use Dativ: einem guten Freund."
    assert finish_reason == "stop"
    messages = captured["payload"]["messages"]
    assert "Answer in the language the learner asked in" in messages[0]["content"]
    assert "Answer in under 150 words" in messages[0]["content"]
    assert "Use one markdown table when presenting forms across gender or case" in messages[0]["content"]
    assert captured["payload"]["max_tokens"] == 1000
    assert "Learner level" not in messages[1]["content"]


def test_generate_answer_falls_back_when_openrouter_model_is_rate_limited(monkeypatch) -> None:
    seen_models: list[str] = []

    def fake_post_json(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: int) -> dict[str, Any]:
        seen_models.append(str(payload["model"]))
        if payload["model"] == "google/gemma-4-31b-it:free":
            raise grammar.GrammarUnavailableError("openrouter.ai request failed with status 429")
        return {"choices": [{"message": {"content": "Use Dativ: mit dem Auto."}, "finish_reason": "stop"}]}

    monkeypatch.setattr(grammar, "_post_json", fake_post_json)
    settings = grammar.Settings(
        cohere_api_key="cohere",
        openrouter_api_key="openrouter",
        openrouter_chat_fallback_models="openrouter/free",
    )
    citation = grammar.GrammarCitation(
        chunk_id="prepositions-dativ",
        title="Dativ Prepositions",
        section="Mit",
        content="Mit takes Dativ.",
        level="A1",
        topic="praeposition_dativ",
        similarity=0.82,
        source_path="data/grammar/prepositions-dativ.md",
    )

    answer, finish_reason = grammar.generate_answer(
        question="Warum mit dem Auto?",
        citations=[citation],
        settings=settings,
    )

    assert answer == "Use Dativ: mit dem Auto."
    assert finish_reason == "stop"
    assert seen_models == ["google/gemma-4-31b-it:free", "openrouter/free"]


def test_generate_answer_returns_length_finish_reason(monkeypatch) -> None:
    def fake_post_json(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: int) -> dict[str, Any]:
        return {"choices": [{"message": {"content": "Use Dativ."}, "finish_reason": "length"}]}

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

    answer, finish_reason = grammar.generate_answer(
        question="warum einem guten Freund?",
        citations=[citation],
        settings=settings,
    )

    assert answer == "Use Dativ."
    assert finish_reason == "length"


def test_openrouter_models_deduplicates_primary_and_fallbacks() -> None:
    settings = grammar.Settings(
        openrouter_chat_model="openrouter/free",
        openrouter_chat_fallback_models="openrouter/free, google/gemma-4-31b-it:free",
    )

    assert grammar._openrouter_models(settings) == [
        "openrouter/free",
        "google/gemma-4-31b-it:free",
    ]


def test_post_json_treats_provider_outages_as_unavailable(monkeypatch) -> None:
    def fail_urlopen(*args: Any, **kwargs: Any) -> Any:
        raise URLError("temporary name resolution failure")

    monkeypatch.setattr(grammar.urlrequest, "urlopen", fail_urlopen)

    try:
        grammar._post_json("https://openrouter.ai/api/v1/chat/completions", {}, {}, timeout=1)
    except grammar.GrammarUnavailableError as exc:
        assert "openrouter.ai request failed" in str(exc)
    else:
        raise AssertionError("Expected GrammarUnavailableError")


def test_post_json_treats_provider_5xx_as_unavailable(monkeypatch) -> None:
    class ProviderError(HTTPError):
        def read(self) -> bytes:
            return b'{"error":"upstream overloaded"}'

    def fail_urlopen(*args: Any, **kwargs: Any) -> Any:
        raise ProviderError(
            url="https://api.cohere.com/v2/embed",
            code=502,
            msg="Bad Gateway",
            hdrs=None,
            fp=None,
        )

    monkeypatch.setattr(grammar.urlrequest, "urlopen", fail_urlopen)

    try:
        grammar._post_json("https://api.cohere.com/v2/embed", {}, {}, timeout=1)
    except grammar.GrammarUnavailableError as exc:
        assert "api.cohere.com request failed with status 502" in str(exc)
    else:
        raise AssertionError("Expected GrammarUnavailableError")


def test_post_json_keeps_bad_provider_responses_as_service_errors(monkeypatch) -> None:
    class ProviderError(HTTPError):
        def read(self) -> bytes:
            return b'{"error":"bad request"}'

    def fail_urlopen(*args: Any, **kwargs: Any) -> Any:
        raise ProviderError(
            url="https://openrouter.ai/api/v1/chat/completions",
            code=400,
            msg="Bad Request",
            hdrs=None,
            fp=None,
        )

    monkeypatch.setattr(grammar.urlrequest, "urlopen", fail_urlopen)

    try:
        grammar._post_json("https://openrouter.ai/api/v1/chat/completions", {}, {}, timeout=1)
    except grammar.GrammarServiceError as exc:
        assert not isinstance(exc, grammar.GrammarUnavailableError)
        assert "openrouter.ai request failed with status 400" in str(exc)
    else:
        raise AssertionError("Expected GrammarServiceError")
