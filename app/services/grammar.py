from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib.parse import urlparse

from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.models import GrammarAnswerCache

CONTENT_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "can",
    "cau",
    "cho",
    "does",
    "explain",
    "for",
    "grammar",
    "how",
    "is",
    "la",
    "my",
    "of",
    "or",
    "please",
    "question",
    "the",
    "this",
    "to",
    "trong",
    "what",
    "when",
    "why",
}
MAX_ACCEPTED_CITATIONS = 6
GERMAN_CASE_TERMS = {"akkusativ", "dativ", "nominativ", "genitiv"}
TERM_ALIASES = {
    "akkusativ": {"akkusativ", "accusative"},
    "dativ": {"dativ", "dative"},
    "nominativ": {"nominativ", "nominative"},
    "genitiv": {"genitiv", "genitive"},
    "article": {"article", "articles", "artikel"},
}
ANSWER_CACHE_VERSION = "grammar-answer-v5"
logger = logging.getLogger(__name__)


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
    keyword_score: float = 0.0
    hybrid_score: float = 0.0
    content_hash: str = ""


@dataclass(frozen=True)
class GrammarAnswer:
    status: str
    answer: str | None
    citations: list[GrammarCitation]
    retrieval_debug: dict[str, Any] | None = None
    cached: bool = False
    finish_reason: str | None = None
    truncated: bool = False


_rate_events: dict[str, list[float]] = {}


def normalize_question(question: str) -> str:
    return " ".join(question.casefold().split())


def question_hash(question: str) -> str:
    return hashlib.sha256(question.encode("utf-8")).hexdigest()


def cache_key(normalized_question: str, settings: Settings) -> str:
    parts = [
        f"version={ANSWER_CACHE_VERSION}",
        f"q={normalized_question}",
        f"embed={settings.cohere_embedding_model}",
        f"abs={settings.grammar_similarity_threshold:.3f}",
        f"rel={settings.grammar_relative_similarity_threshold:.3f}",
        f"min_words={settings.grammar_min_query_words}",
    ]
    return "\n".join(parts)


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
    query_quality = assess_query_quality(question, settings=settings)
    if not query_quality["retrievable"]:
        return GrammarAnswer(
            status="no_match",
            answer=clarification_prompt(question),
            citations=[],
            retrieval_debug={"query": query_quality} if include_debug else None,
        )

    cached = _get_cached_answer(db, cache_key(normalized, settings))
    if cached is not None:
        answer, citations, finish_reason, truncated = cached
        return GrammarAnswer(
            status="answered",
            answer=answer,
            citations=citations,
            retrieval_debug={"cache": "hit"} if include_debug else None,
            cached=True,
            finish_reason=finish_reason,
            truncated=truncated,
        )

    query_embedding = embed_texts([question], input_type="search_query", settings=settings)[0]
    retrieved = retrieve_grammar_chunks(
        db=db,
        embedding=query_embedding,
        query_text=question,
    )
    accepted, filter_debug = filter_grammar_chunks(retrieved, query_text=question, settings=settings)
    debug = (
        {
            "cache": "miss",
            "query": query_quality,
            "absolute_floor": settings.grammar_similarity_threshold,
            "relative_floor": settings.grammar_relative_similarity_threshold,
            **filter_debug,
        }
        if include_debug
        else None
    )
    if not accepted:
        return GrammarAnswer(status="no_match", answer=None, citations=[], retrieval_debug=debug)

    answer, finish_reason = generate_answer(question=question, citations=accepted, settings=settings)
    truncated = finish_reason == "length"
    _store_cached_answer(db, cache_key(normalized, settings), answer, accepted, finish_reason, truncated)
    return GrammarAnswer(
        status="answered",
        answer=answer,
        citations=accepted,
        retrieval_debug=debug,
        finish_reason=finish_reason,
        truncated=truncated,
    )


def assess_query_quality(question: str, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    words = [word for word in normalize_question(question).replace("?", " ").split() if word]
    content_words = [
        word
        for word in words
        if word.strip(".,:;!?()[]{}\"'`") not in CONTENT_STOPWORDS
    ]
    retrievable = len(words) >= settings.grammar_min_query_words and len(content_words) > 0
    return {
        "retrievable": retrievable,
        "word_count": len(words),
        "content_word_count": len(content_words),
        "min_query_words": settings.grammar_min_query_words,
        "reason": None if retrievable else "too_short_or_vague",
    }


def clarification_prompt(question: str) -> str:
    terms = [
        word.strip(".,:;!?()[]{}\"'`")
        for word in normalize_question(question).split()
        if word.strip(".,:;!?()[]{}\"'`")
    ]
    if len(terms) == 1:
        term = terms[0].capitalize()
        return f"What would you like to know about the {term}?"
    return "What would you like to know about that grammar point?"


def filter_grammar_chunks(
    citations: list[GrammarCitation],
    query_text: str = "",
    settings: Settings | None = None,
) -> tuple[list[GrammarCitation], dict[str, Any]]:
    settings = settings or get_settings()
    top_score = max((citation.similarity for citation in citations), default=0.0)
    relative_floor_score = top_score * settings.grammar_relative_similarity_threshold
    requested_cases = _case_terms(query_text)
    requested_terms = _query_content_terms(query_text)
    accepted: list[GrammarCitation] = []
    seen_fingerprints: set[str] = set()
    chunk_debug: list[dict[str, Any]] = []

    for citation in citations:
        removed_by: str | None = None
        if citation.similarity < settings.grammar_similarity_threshold:
            removed_by = "absolute_floor"
        elif citation.similarity < relative_floor_score:
            removed_by = "relative_floor"
        elif _has_conflicting_case_term(citation, requested_cases):
            removed_by = "conflicting_case_term"
        elif not _has_requested_terms(citation, requested_terms):
            removed_by = "missing_requested_terms"
        else:
            fingerprint = _citation_fingerprint(citation)
            if fingerprint in seen_fingerprints or _is_near_duplicate(citation, accepted):
                removed_by = "duplicate"
            elif len(accepted) >= MAX_ACCEPTED_CITATIONS:
                removed_by = "cap"
            else:
                seen_fingerprints.add(fingerprint)
                accepted.append(citation)

        item = _citation_debug(citation)
        item["raw_score"] = citation.similarity
        item["top_score"] = top_score
        item["relative_floor_score"] = relative_floor_score
        item["requested_case_terms"] = sorted(requested_cases)
        item["requested_terms"] = sorted(requested_terms)
        item["removed_by"] = removed_by
        item["kept"] = removed_by is None
        chunk_debug.append(item)

    return accepted, {
        "top_score": top_score,
        "relative_floor_score": relative_floor_score,
        "accepted_count": len(accepted),
        "chunks": chunk_debug,
    }


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
    query_text: str,
) -> list[GrammarCitation]:
    if db.bind is None or db.bind.dialect.name != "postgresql":
        raise GrammarUnavailableError("Grammar retrieval requires a Postgres pgvector database")
    embedding_literal = "[" + ",".join(f"{value:.8f}" for value in embedding) + "]"
    rows = db.execute(
        text(
            """
            with vector_candidates as (
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
                    content_hash,
                    1 - (embedding <=> cast(:embedding as extensions.vector)) as similarity
                from grammar_chunks
                order by embedding <=> cast(:embedding as extensions.vector)
                limit 24
            ),
            scored as (
                select
                    *,
                    ts_rank_cd(
                        to_tsvector(
                            'simple',
                            coalesce(title, '') || ' ' ||
                            coalesce(section, '') || ' ' ||
                            coalesce(content, '')
                        ),
                        plainto_tsquery('simple', :query_text)
                    ) as keyword_score
                from vector_candidates
            )
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
                content_hash,
                similarity,
                keyword_score,
                similarity * 0.70 + least(keyword_score, 1.0) * 0.30 as hybrid_score
            from scored
            order by hybrid_score desc, similarity desc
            limit 12
            """
        ),
        {"embedding": embedding_literal, "query_text": query_text},
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
            keyword_score=float(row["keyword_score"]),
            hybrid_score=float(row["hybrid_score"]),
            content_hash=str(row["content_hash"]),
        )
        for row in rows
    ]


def generate_answer(
    question: str,
    citations: list[GrammarCitation],
    settings: Settings | None = None,
) -> tuple[str, str | None]:
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
                    "Do not use outside knowledge, even if you know the answer. "
                    "Answer in the language the learner asked in. Explain in plain terms suited to a beginner. "
                    "Keep German grammar terms in German. Give at least one German example sentence. "
                    "If a rule has a simple case and an advanced exception, lead with the simple case. "
                    "If the retrieved notes do not directly cover the question, say plainly that the notes do not cover it. "
                    "Answer in under 150 words. Use one markdown table when presenting forms across gender or case. "
                    "Do not present gender or case forms as bullets if a table would fit. "
                    "Otherwise use plain paragraphs and short lists. No headings. "
                    "Every markdown table must have four columns or fewer; split wider form sets into multiple smaller tables."
                ),
            },
            {
                "role": "user",
                "content": f"Question: {question}\n\nGrammar notes:\n{context}",
            },
        ],
        "temperature": 0.2,
        "max_tokens": 1000,
    }
    headers = {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
    }
    if settings.openrouter_http_referer:
        headers["HTTP-Referer"] = settings.openrouter_http_referer
    if settings.openrouter_app_title:
        headers["X-Title"] = settings.openrouter_app_title
    provider_errors: list[str] = []
    for model in _openrouter_models(settings):
        payload["model"] = model
        try:
            data = _post_json(
                "https://openrouter.ai/api/v1/chat/completions",
                payload,
                headers,
                timeout=45,
            )
            break
        except GrammarUnavailableError as exc:
            provider_errors.append(f"{model}: {exc}")
    else:
        raise GrammarUnavailableError("; ".join(provider_errors))

    try:
        choice = data["choices"][0]
        content = choice["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise GrammarServiceError("OpenRouter response did not include an answer") from exc
    if not isinstance(content, str) or not content.strip():
        raise GrammarServiceError("OpenRouter returned an empty answer")
    finish_reason = choice.get("finish_reason")
    if finish_reason is not None and not isinstance(finish_reason, str):
        finish_reason = str(finish_reason)
    logger.info("Grammar assistant completion finish_reason=%s", finish_reason)
    return content.strip(), finish_reason


def _openrouter_models(settings: Settings) -> list[str]:
    models = [settings.openrouter_chat_model]
    models.extend(
        model.strip()
        for model in settings.openrouter_chat_fallback_models.split(",")
        if model.strip()
    )
    return list(dict.fromkeys(models))


def _get_cached_answer(
    db: Session,
    normalized_question: str,
) -> tuple[str, list[GrammarCitation], str | None, bool] | None:
    row = db.scalar(
        select(GrammarAnswerCache).where(
            GrammarAnswerCache.question_hash == question_hash(normalized_question),
        )
    )
    if row is None:
        return None
    metadata = _cache_metadata(row.citations_json)
    return (
        row.answer,
        [_citation_from_dict(item) for item in metadata["citations"]],
        metadata["finish_reason"],
        metadata["truncated"],
    )


def _store_cached_answer(
    db: Session,
    normalized_question: str,
    answer: str,
    citations: list[GrammarCitation],
    finish_reason: str | None,
    truncated: bool,
) -> None:
    row = GrammarAnswerCache(
        question_hash=question_hash(normalized_question),
        normalized_question=normalized_question,
        answer=answer,
        citations_json=json.dumps(
            {
                "citations": [_citation_to_dict(citation) for citation in citations],
                "finish_reason": finish_reason,
                "truncated": truncated,
            }
        ),
    )
    db.add(row)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()


def _cache_metadata(raw: str) -> dict[str, Any]:
    parsed = json.loads(raw)
    if isinstance(parsed, list):
        return {"citations": parsed, "finish_reason": None, "truncated": False}
    if not isinstance(parsed, dict):
        return {"citations": [], "finish_reason": None, "truncated": False}
    citations = parsed.get("citations")
    return {
        "citations": citations if isinstance(citations, list) else [],
        "finish_reason": parsed.get("finish_reason"),
        "truncated": bool(parsed.get("truncated")),
    }


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
        host = urlparse(url).netloc or "provider"
        if exc.code in {401, 403, 429} or exc.code >= 500:
            raise GrammarUnavailableError(
                f"{host} request failed with status {exc.code}: {body[:300]}"
            ) from exc
        raise GrammarServiceError(
            f"{host} request failed with status {exc.code}: {body[:300]}"
        ) from exc
    except (urlerror.URLError, TimeoutError) as exc:
        host = urlparse(url).netloc or "provider"
        raise GrammarUnavailableError(f"{host} request failed") from exc


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
        "keyword_score": citation.keyword_score,
        "hybrid_score": citation.hybrid_score,
        "content_hash": citation.content_hash,
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
        keyword_score=float(data.get("keyword_score", 0.0)),
        hybrid_score=float(data.get("hybrid_score", 0.0)),
        content_hash=str(data.get("content_hash", "")),
    )


def _citation_debug(citation: GrammarCitation) -> dict[str, Any]:
    data = _citation_to_dict(citation)
    data["content"] = citation.content[:240]
    return data


def _citation_fingerprint(citation: GrammarCitation) -> str:
    if citation.content_hash:
        return citation.content_hash
    normalized_content = " ".join(citation.content.casefold().split())
    return hashlib.sha256(normalized_content.encode("utf-8")).hexdigest()


def _is_near_duplicate(candidate: GrammarCitation, accepted: list[GrammarCitation]) -> bool:
    candidate_tokens = set(_content_tokens(candidate.content))
    if not candidate_tokens:
        return False
    for citation in accepted:
        existing_tokens = set(_content_tokens(citation.content))
        if not existing_tokens:
            continue
        overlap = len(candidate_tokens & existing_tokens)
        smaller = min(len(candidate_tokens), len(existing_tokens))
        union = len(candidate_tokens | existing_tokens)
        if overlap / smaller >= 0.90 or overlap / union >= 0.82:
            return True
    return False


def _has_conflicting_case_term(citation: GrammarCitation, requested_cases: set[str]) -> bool:
    if not requested_cases:
        return False
    citation_cases = _case_terms(
        f"{citation.title} {citation.section} {citation.content}"
    )
    return bool(citation_cases) and citation_cases.isdisjoint(requested_cases)


def _has_requested_terms(citation: GrammarCitation, requested_terms: set[str]) -> bool:
    if len(requested_terms) < 2:
        return True
    citation_tokens = set(_content_tokens(f"{citation.title} {citation.section} {citation.content}"))
    missing = [
        term
        for term in requested_terms
        if citation_tokens.isdisjoint(TERM_ALIASES.get(term, {term}))
    ]
    return not missing


def _query_content_terms(text: str) -> set[str]:
    terms = set()
    for token in _content_tokens(text):
        if token in CONTENT_STOPWORDS:
            continue
        if token.endswith("s") and len(token) > 4:
            token = token[:-1]
        canonical = _canonical_term(token)
        if canonical:
            terms.add(canonical)
    return terms


def _canonical_term(token: str) -> str | None:
    for term, aliases in TERM_ALIASES.items():
        if token in aliases:
            return term
    return token if token in GERMAN_CASE_TERMS else None


def _case_terms(text: str) -> set[str]:
    tokens = _content_tokens(text)
    return {token for token in tokens if token in GERMAN_CASE_TERMS}


def _content_tokens(text: str) -> list[str]:
    return [
        token.strip(".,:;!?()[]{}\"'`").casefold()
        for token in text.split()
        if len(token.strip(".,:;!?()[]{}\"'`")) > 2
    ]


def citation_label(citation: GrammarCitation) -> str:
    page_label = ""
    if citation.page_start is not None and citation.page_end is not None:
        if citation.page_start == citation.page_end:
            page_label = f" · p. {citation.page_start}"
        else:
            page_label = f" · pp. {citation.page_start}-{citation.page_end}"
    return f"{citation.title} / {citation.section}{page_label}"
