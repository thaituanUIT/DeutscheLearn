"""Generate answer-and-source packets for human grounding review."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.grammar import answer_grammar_question

DEFAULT_CASES = Path("evals/learner_questions.jsonl")
DEFAULT_OUTPUT = Path("evals/answer_review.jsonl")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate answers with their retrieved sources for human grounding review."
    )
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    if not args.cases.exists():
        parser.error(f"case file does not exist: {args.cases}")
    cases = [
        json.loads(line)
        for line in args.cases.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not cases:
        parser.error(f"case file is empty: {args.cases}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    settings = get_settings()
    with SessionLocal() as db, args.output.open("w", encoding="utf-8") as output:
        for case in cases:
            result = answer_grammar_question(
                db=db,
                question=case["question"],
                include_debug=True,
                settings=settings,
            )
            record: dict[str, Any] = {
                "id": case.get("id"),
                "question": case["question"],
                "expected_sections": case.get("required_sections", []),
                "expected_points": case.get("expected_points", []),
                "answerable": case.get("answerable", True),
                "status": result.status,
                "answer": result.answer,
                "cached": result.cached,
                "retrieval_debug": result.retrieval_debug,
                "sources": [
                    {
                        "chunk_id": citation.chunk_id,
                        "title": citation.title,
                        "section": citation.section,
                        "similarity": citation.similarity,
                        "content": citation.content,
                    }
                    for citation in result.citations
                ],
            }
            output.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"Wrote answer review packets to {args.output}")


if __name__ == "__main__":
    main()
