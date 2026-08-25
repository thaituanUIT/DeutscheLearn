from __future__ import annotations

import json
from pathlib import Path

GOLDEN_PATH = Path("evals/golden.jsonl")


def main() -> None:
    cases = load_cases()
    answerable = [case for case in cases if case["answerable"]]
    unanswerable = [case for case in cases if not case["answerable"]]
    print(f"Loaded {len(cases)} golden cases ({len(unanswerable)} unanswerable).")
    print()
    print("                          Full-hit@5   Recall@5   MRR    Correct   Abstain   Cost")
    print(format_row("no RAG baseline", None, None, None, 0.0, baseline_abstain(unanswerable, cases), 0.0))
    print(format_row("vector only", 0.0, 0.0, 0.0, 0.0, 0.0, estimated_embedding_cost(answerable)))
    print(format_row("+ query rewrite", 0.0, 0.0, 0.0, 0.0, 0.0, estimated_embedding_cost(answerable) * 2))
    print()
    print("Generation judge is disabled until 20 hand-scored items are recorded in README.md.")


def load_cases() -> list[dict]:
    if not GOLDEN_PATH.exists():
        raise SystemExit(f"Missing {GOLDEN_PATH}")
    return [json.loads(line) for line in GOLDEN_PATH.read_text(encoding="utf-8").splitlines() if line]


def format_row(
    name: str,
    full_hit: float | None,
    recall: float | None,
    mrr: float | None,
    correct: float,
    abstain: float,
    cost: float,
) -> str:
    return (
        f"{name:<26}"
        f"{metric(full_hit):>11}"
        f"{metric(recall):>11}"
        f"{metric(mrr):>7}"
        f"{percent(correct):>10}"
        f"{percent(abstain):>10}"
        f"{f'${cost:.3f}':>10}"
    )


def metric(value: float | None) -> str:
    return "—" if value is None else f"{value:.2f}"


def percent(value: float) -> str:
    return f"{value:.0%}"


def baseline_abstain(unanswerable: list[dict], cases: list[dict]) -> float:
    if not cases:
        return 0.0
    return len(unanswerable) / len(cases)


def estimated_embedding_cost(cases: list[dict]) -> float:
    return round(len(cases) * 0.00002, 4)


if __name__ == "__main__":
    main()
