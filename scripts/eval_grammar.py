from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import Settings, get_settings
from app.db.session import SessionLocal
from app.services.grammar import (
    assess_query_quality,
    embed_texts,
    filter_grammar_chunks,
    retrieve_grammar_chunks,
)

GOLDEN_PATH = Path("evals/golden.jsonl")
RESULTS_PATH = Path("evals/results.json")
DEFAULT_ABSOLUTE_FLOORS = [round(value / 100, 2) for value in range(30, 71, 5)]


@dataclass(frozen=True)
class CaseResult:
    case: dict[str, Any]
    retrieved_ids: list[str]
    abstained: bool


def main() -> None:
    args = parse_args()
    cases = load_cases()
    settings = get_settings()
    absolute_floors = parse_floors(args.absolute_floors)
    relative_floor = args.relative_floor

    print(f"Loaded {len(cases)} golden cases.")
    print(
        f"Embedding model: {settings.cohere_embedding_model} "
        f"({settings.cohere_embedding_dimension} dimensions)"
    )
    print(f"Relative floor: {relative_floor:.2f}")
    print()

    raw_results = retrieve_cases(cases, settings)
    rows = [
        evaluate_floor(raw_results, settings, absolute_floor, relative_floor)
        for absolute_floor in absolute_floors
    ]
    chosen = choose_floor(rows)
    print_table(rows, chosen)
    write_results(settings, rows, chosen, relative_floor)
    print()
    print(f"Wrote calibration results to {RESULTS_PATH}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sweep grammar retrieval thresholds.")
    parser.add_argument(
        "--absolute-floors",
        default=",".join(f"{value:.2f}" for value in DEFAULT_ABSOLUTE_FLOORS),
        help="Comma-separated absolute similarity floors to sweep.",
    )
    parser.add_argument(
        "--relative-floor",
        type=float,
        default=get_settings().grammar_relative_similarity_threshold,
        help="Relative floor as a fraction of the top raw similarity score.",
    )
    return parser.parse_args()


def load_cases() -> list[dict[str, Any]]:
    if not GOLDEN_PATH.exists():
        raise SystemExit(f"Missing {GOLDEN_PATH}")
    return [json.loads(line) for line in GOLDEN_PATH.read_text(encoding="utf-8").splitlines() if line]


def parse_floors(value: str) -> list[float]:
    return [float(item.strip()) for item in value.split(",") if item.strip()]


def retrieve_cases(cases: list[dict[str, Any]], settings: Settings) -> list[dict[str, Any]]:
    questions = [case["question"] for case in cases]
    embeddings = embed_texts(questions, input_type="search_query", settings=settings)
    results: list[dict[str, Any]] = []
    with SessionLocal() as db:
        for case, embedding in zip(cases, embeddings, strict=True):
            query_quality = assess_query_quality(case["question"], settings=settings)
            citations = []
            if query_quality["retrievable"]:
                citations = retrieve_grammar_chunks(db, embedding, query_text=case["question"])
            results.append(
                {
                    "case": case,
                    "query_quality": query_quality,
                    "citations": citations,
                }
            )
    return results


def evaluate_floor(
    raw_results: list[dict[str, Any]],
    settings: Settings,
    absolute_floor: float,
    relative_floor: float,
) -> dict[str, Any]:
    eval_settings = settings.model_copy(
        update={
            "grammar_similarity_threshold": absolute_floor,
            "grammar_relative_similarity_threshold": relative_floor,
        }
    )
    case_results: list[CaseResult] = []
    for raw in raw_results:
        case = raw["case"]
        if not raw["query_quality"]["retrievable"]:
            case_results.append(CaseResult(case=case, retrieved_ids=[], abstained=True))
            continue
        accepted, _debug = filter_grammar_chunks(
            raw["citations"],
            query_text=case["question"],
            settings=eval_settings,
        )
        retrieved_ids = [citation.chunk_id for citation in accepted]
        case_results.append(
            CaseResult(case=case, retrieved_ids=retrieved_ids, abstained=len(retrieved_ids) == 0)
        )

    answerable = [result for result in case_results if result.case["answerable"]]
    unanswerable = [result for result in case_results if not result.case["answerable"]]
    return {
        "absolute_floor": absolute_floor,
        "full_hit_at_k": full_hit_at_k(answerable),
        "precision": precision(answerable),
        "unanswerable_abstention_rate": abstention_rate(unanswerable),
        "answerable_abstention_rate": abstention_rate(answerable),
        "avg_chunks": avg_chunks(case_results),
    }


def full_hit_at_k(results: list[CaseResult]) -> float:
    if not results:
        return 0.0
    hits = 0
    for result in results:
        required = set(result.case["required_chunks"])
        retrieved = set(result.retrieved_ids)
        if required and required <= retrieved:
            hits += 1
    return hits / len(results)


def precision(results: list[CaseResult]) -> float:
    retrieved_count = 0
    relevant_count = 0
    for result in results:
        required = set(result.case["required_chunks"])
        retrieved_count += len(result.retrieved_ids)
        relevant_count += len(required & set(result.retrieved_ids))
    if retrieved_count == 0:
        return 0.0
    return relevant_count / retrieved_count


def abstention_rate(results: list[CaseResult]) -> float:
    if not results:
        return 0.0
    return sum(1 for result in results if result.abstained) / len(results)


def avg_chunks(results: list[CaseResult]) -> float:
    if not results:
        return 0.0
    return sum(len(result.retrieved_ids) for result in results) / len(results)


def choose_floor(rows: list[dict[str, Any]]) -> dict[str, Any]:
    max_full_hit = max(row["full_hit_at_k"] for row in rows)
    candidates = [row for row in rows if row["full_hit_at_k"] == max_full_hit]
    return max(
        candidates,
        key=lambda row: (
            row["unanswerable_abstention_rate"],
            row["precision"],
            row["absolute_floor"],
        ),
    )


def print_table(rows: list[dict[str, Any]], chosen: dict[str, Any]) -> None:
    print("Abs floor   Full-hit@k   Precision   Unanswerable abstain   Answerable abstain   Avg chunks")
    for row in rows:
        marker = "*" if row is chosen else " "
        print(
            f"{marker} {row['absolute_floor']:<9.2f}"
            f"{row['full_hit_at_k']:>10.2f}"
            f"{row['precision']:>12.2f}"
            f"{row['unanswerable_abstention_rate']:>22.0%}"
            f"{row['answerable_abstention_rate']:>20.0%}"
            f"{row['avg_chunks']:>13.2f}"
        )


def write_results(
    settings: Settings,
    rows: list[dict[str, Any]],
    chosen: dict[str, Any],
    relative_floor: float,
) -> None:
    RESULTS_PATH.write_text(
        json.dumps(
            {
                "embedding_model": settings.cohere_embedding_model,
                "embedding_dimension": settings.cohere_embedding_dimension,
                "chosen_absolute_floor": chosen["absolute_floor"],
                "relative_floor": relative_floor,
                "selection_rule": (
                    "Highest unanswerable abstention among floors with max Full-hit@k; "
                    "precision and higher floor break ties."
                ),
                "rows": rows,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
