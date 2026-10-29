import json
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.security import has_admin_bearer as _has_admin_bearer
from app.db.models import (
    GrammarQuestionLog,
)
from app.db.session import get_db
from app.schemas import (
    GrammarAskIn,
    GrammarAskOut,
    GrammarCitationOut,
)
from app.services.grammar import (
    GrammarAnswer,
    GrammarServiceError,
    GrammarUnavailableError,
    answer_grammar_question,
    check_rate_limit,
    grammar_context_type,
    normalize_question,
)

router = APIRouter(tags=["grammar"])
logger = logging.getLogger(__name__)


@router.post("/grammar/ask", response_model=GrammarAskOut)
def grammar_ask(
    payload: GrammarAskIn,
    request: Request,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> GrammarAskOut:
    include_debug = payload.include_debug and _has_admin_bearer(authorization)
    client_ip = request.client.host if request.client else "unknown"
    try:
        check_rate_limit(payload.learner_id, client_ip)
        context = payload.context.model_dump(exclude_none=True) if payload.context else None
        result = answer_grammar_question(
            db=db,
            question=payload.question.strip(),
            context=context,
            include_debug=include_debug,
        )
    except PermissionError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="You've asked a lot of questions. Try again in a few minutes.",
        ) from None
    except GrammarUnavailableError as exc:
        logger.warning("Grammar assistant unavailable: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The grammar assistant is unavailable right now.",
        ) from exc
    except GrammarServiceError as exc:
        logger.exception("Grammar assistant provider failure")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Something went wrong while answering.",
        ) from exc
    log_grammar_question(
        db=db,
        learner_id=payload.learner_id,
        question=payload.question,
        route=payload.context.route if payload.context else None,
        context_type=grammar_context_type(context),
        result=result,
    )
    return GrammarAskOut(
        status=result.status,
        answer=result.answer,
        citations=[
            GrammarCitationOut(
                chunk_id=citation.chunk_id,
                title=citation.title,
                section=citation.section,
                content=citation.content,
                level=citation.level,
                topic=citation.topic,
                similarity=citation.similarity,
                source_path=citation.source_path,
                source_kind=citation.source_kind,
                page_start=citation.page_start,
                page_end=citation.page_end,
            )
            for citation in result.citations
        ],
        retrieval_debug=result.retrieval_debug if include_debug else None,
        cached=result.cached,
        finish_reason=result.finish_reason,
        truncated=result.truncated,
        retrieval_query=result.retrieval_query if include_debug else None,
    )


def log_grammar_question(
    db: Session,
    learner_id: str | None,
    question: str,
    route: str | None,
    context_type: str | None,
    result: GrammarAnswer,
) -> None:
    try:
        citations = result.citations
        debug = result.retrieval_debug
        row = GrammarQuestionLog(
            learner_id=learner_id,
            normalized_question=normalize_question(question),
            retrieval_query=result.retrieval_query,
            status=result.status,
            context_type=context_type,
            route=route,
            cited_chunk_ids_json=json.dumps([citation.chunk_id for citation in citations]),
            retrieval_debug_json=json.dumps(debug) if debug is not None else None,
            cached=bool(result.cached),
        )
        db.add(row)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to log grammar question")
