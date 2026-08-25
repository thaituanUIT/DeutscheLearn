from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.models import GrammarAnswerCache


class GrammarServiceError(RuntimeError):
    pass


class GrammarUnavailableError(GrammarServiceError):
    pass


@dataclass(frozen=True)
class GrammarCitation:
    chunk_id: str
    title: str
    section: str
    content: str
    level: str
    topic: str
    similarity: float
    source_path: str
    source_kind: str = "markdown"
    page_start: int | None = None
    page_end: int | None = None


@dataclass(frozen=True)
class GrammarAnswer:
    status: str
    answer: str | None
    citations: list[GrammarCitation]
    retrieval_debug: dict[str, Any] | None = None
    cached: bool = False


_rate_events: dict[str, list[float]] = {}


def normalize_question(question: str) -> str:
    return " ".join(question.casefold().split())


def question_hash(question: str) -> str:
    return hashlib.sha256(normalize_question(question).encode("utf-8")).hexdigest()


def check_rate_limit(
    learner_id: str | None,
    ip_address: str,
    settings: Settings | None = None,
) -> None:
    settings = settings or get_settings()
    now = time.time()
    window_start = now - 3600
    keys = [f"ip:{ip_address}"]
    if learner_id:
        keys.append(f"learner:{learner_id}")
    for key in keys:
        _rate_events[key] = [event for event in _rate_events.get(key, []) if event >= window_start]
        if len(_rate_events[key]) >= settings.grammar_rate_limit_per_hour:
            raise PermissionError("rate_limited")
    for key in keys:
        _rate_events.setdefault(key, []).append(now)


def answer_grammar_question(
    db: Session,
    question: str,
    include_debug: bool = False,
    settings: Settings | None = None,
) -> GrammarAnswer:
    settings = settings or get_settings()
    normalized = normalize_question(question)
    cached = _get_cached_answer(db, normalized)
    if cached is not None:
        answer, citations = cached
        return GrammarAnswer(
            status="answered",
            answer=answer,
            citations=citations,
            retrieval_debug={"cache": "hit"} if include_debug else None,
            cached=True,
        )

    query_embedding = embed_texts([question], input_type="search_query", settings=settings)[0]
    retrieved = retrieve_grammar_chunks(
        db=db,
        embedding=query_embedding,
    )
    accepted = [
        citation
        for citation in retrieved
        if citation.similarity >= settings.grammar_similarity_threshold
    ][:6]
    debug = (
        {
            "cache": "miss",
            "threshold": settings.grammar_similarity_threshold,
            "retrieved": [_citation_debug(citation) for citation in retrieved],
        }
        if include_debug
        else None
    )
    if not accepted:
        return GrammarAnswer(status="no_match", answer=None, citations=[], retrieval_debug=debug)

    answer = generate_answer(question=question, citations=accepted, settings=settings)
    _store_cached_answer(db, normalized, answer, accepted)
    return GrammarAnswer(status="answered", answer=answer, citations=accepted, retrieval_debug=debug)


def embed_texts(texts: list[str], input_type: str, settings: Settings | None = None) -> list[list[float]]:
    settings = settings or get_settings()
    if not settings.cohere_api_key:
        raise GrammarUnavailableError("COHERE_API_KEY is not configured")
    payload = {
        "texts": texts,
        "model": settings.cohere_embedding_model,
        "input_type": input_type,
        "embedding_types": ["float"],
    }
    data = _post_json(
        "https://api.cohere.com/v2/embed",
        payload,
        {
            "Authorization": f"Bearer {settings.cohere_api_key}",
            "Content-Type": "application/json",
        },
        timeout=30,
    )
    embeddings = data.get("embeddings", {}).get("float")
    if not isinstance(embeddings, list):
        raise GrammarServiceError("Cohere response did not include float embeddings")
    for embedding in embeddings:
        if len(embedding) != settings.cohere_embedding_dimension:
            raise GrammarServiceError("Cohere embedding dimension does not match configured schema")
    return embeddings


def retrieve_grammar_chunks(
    db: Session,
    embedding: list[float],
) -> list[GrammarCitation]:
    if db.bind is None or db.bind.dialect.name != "postgresql":
        raise GrammarUnavailableError("Grammar retrieval requires a Postgres pgvector database")
    embedding_literal = "[" + ",".join(f"{value:.8f}" for value in embedding) + "]"
    rows = db.execute(
        text(
            """
            select
                id,
                title,
                section,
                content,
                level,
                topic,
                source_path,
                source_kind,
                page_start,
                page_end,
                1 - (embedding <=> cast(:embedding as extensions.vector)) as similarity
            from grammar_chunks
            order by embedding <=> cast(:embedding as extensions.vector)
            limit 12
            """
        ),
        {"embedding": embedding_literal},
    ).mappings()
    return [
        GrammarCitation(
            chunk_id=str(row["id"]),
            title=str(row["title"]),
            section=str(row["section"]),
            content=str(row["content"]),
            level=str(row["level"]),
            topic=str(row["topic"]),
            similarity=float(row["similarity"]),
            source_path=str(row["source_path"]),
            source_kind=str(row["source_kind"]),
            page_start=int(row["page_start"]) if row["page_start"] is not None else None,
            page_end=int(row["page_end"]) if row["page_end"] is not None else None,
        )
        for row in rows
    ]


def generate_answer(
    question: str,
    citations: list[GrammarCitation],
    settings: Settings | None = None,
) -> str:
    settings = settings or get_settings()
    if not settings.openrouter_api_key:
        raise GrammarUnavailableError("OPENROUTER_API_KEY is not configured")
    context = "\n\n".join(
        f"[{index}] {citation_label(citation)}\n{citation.content}"
        for index, citation in enumerate(citations, start=1)
    )
    payload = {
        "model": settings.openrouter_chat_model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a German grammar tutor. Answer only from the provided grammar notes. "
                    "Answer in the language the learner asked in. Explain in plain terms suited to a beginner. "
                    "Keep German grammar terms in German. Give at least one German example sentence. "
                    "If a rule has a simple case and an advanced exception, lead with the simple case. "
                    "If the notes do not support the answer, say it is not covered."
                ),
            },
            {
                "role": "user",
                "content": f"Question: {question}\n\nGrammar notes:\n{context}",
            },
        ],
        "temperature": 0.2,
        "max_tokens": 500,
    }
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
    }
    if settings.openrouter_http_referer:
        headers["HTTP-Referer"] = settings.openrouter_http_referer
    if settings.openrouter_app_title:
        headers["X-Title"] = settings.openrouter_app_title
    data = _post_json("https://openrouter.ai/api/v1/chat/completions", payload, headers, timeout=45)
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise GrammarServiceError("OpenRouter response did not include an answer") from exc
    if not isinstance(content, str) or not content.strip():
        raise GrammarServiceError("OpenRouter returned an empty answer")
    return content.strip()


def _get_cached_answer(
    db: Session,
    normalized_question: str,
) -> tuple[str, list[GrammarCitation]] | None:
    row = db.scalar(
        select(GrammarAnswerCache).where(
            GrammarAnswerCache.question_hash == question_hash(normalized_question),
        )
    )
    if row is None:
        return None
    return row.answer, [_citation_from_dict(item) for item in json.loads(row.citations_json)]


def _store_cached_answer(
    db: Session,
    normalized_question: str,
    answer: str,
    citations: list[GrammarCitation],
) -> None:
    row = GrammarAnswerCache(
        question_hash=question_hash(normalized_question),
        normalized_question=normalized_question,
        answer=answer,
        citations_json=json.dumps([_citation_to_dict(citation) for citation in citations]),
    )
    db.add(row)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()


def _post_json(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout: int,
) -> dict[str, Any]:
    request = urlrequest.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urlrequest.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urlerror.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise GrammarServiceError(f"Provider request failed: {exc.code} {body[:300]}") from exc
    except (urlerror.URLError, TimeoutError) as exc:
        raise GrammarServiceError("Provider request failed") from exc


def _citation_to_dict(citation: GrammarCitation) -> dict[str, Any]:
    return {
        "chunk_id": citation.chunk_id,
        "title": citation.title,
        "section": citation.section,
        "content": citation.content,
        "level": citation.level,
        "topic": citation.topic,
        "similarity": citation.similarity,
        "source_path": citation.source_path,
        "source_kind": citation.source_kind,
        "page_start": citation.page_start,
        "page_end": citation.page_end,
    }


def _citation_from_dict(data: dict[str, Any]) -> GrammarCitation:
    return GrammarCitation(
        chunk_id=str(data["chunk_id"]),
        title=str(data["title"]),
        section=str(data["section"]),
        content=str(data["content"]),
        level=str(data["level"]),
        topic=str(data["topic"]),
        similarity=float(data.get("similarity", 1.0)),
        source_path=str(data.get("source_path", "")),
        source_kind=str(data.get("source_kind", "markdown")),
        page_start=int(data["page_start"]) if data.get("page_start") is not None else None,
        page_end=int(data["page_end"]) if data.get("page_end") is not None else None,
    )


def _citation_debug(citation: GrammarCitation) -> dict[str, Any]:
    data = _citation_to_dict(citation)
    data["content"] = citation.content[:240]
    return data


def citation_label(citation: GrammarCitation) -> str:
    page_label = ""
    if citation.page_start is not None and citation.page_end is not None:
        if citation.page_start == citation.page_end:
            page_label = f" · p. {citation.page_start}"
        else:
            page_label = f" · pp. {citation.page_start}-{citation.page_end}"
    return f"{citation.title} / {citation.section}{page_label}"
