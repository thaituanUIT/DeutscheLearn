"""Benchmark pgvector vs Qdrant on the locked BasicGerman retrieval set."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import re
import statistics
import sys
import time
import uuid
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg
import requests
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
GOLDEN = ROOT / "evals/golden.jsonl"
LOCK = ROOT / "evals/golden.lock"
SECTIONS = ROOT / "evals/basic_german_sections.json"
CACHE = ROOT / "evals/cache"
NOTEBOOK = ROOT / "evals/lab_notebook.jsonl"
PER_ITEM = ROOT / "evals/per_item_results.jsonl"
REPORT = ROOT / "evals/REPORT.md"
PREREG = ROOT / "evals/preregistration.json"

PG_DSN = os.getenv(
    "EVAL_DATABASE_URL",
    "postgresql://retrieval_eval:retrieval_eval_local_only@127.0.0.1:55432/retrieval_eval",
)
COHERE_MODEL = os.getenv("COHERE_EMBEDDING_MODEL", "embed-multilingual-v3.0")
COHERE_DIM = int(os.getenv("COHERE_EMBEDDING_DIMENSION", "1024"))
K_VALUES = (3, 5)
EF_SWEEP = (8, 16, 32, 64, 128)
RRF_K = 60
SPEND_CAP = 10.0


def env_value(*names: str, default: str | None = None) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    env_path = ROOT / ".env"
    if not env_path.exists():
        return default
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, raw = stripped.split("=", 1)
        if key.strip() in names:
            return raw.strip().strip('"').strip("'")
    return default


QDRANT_URL = (env_value("EVAL_QDRANT_URL", "QDRANT_ENDPOINT", default="http://127.0.0.1:56333") or "").rstrip("/")
QDRANT_API_KEY = env_value("EVAL_QDRANT_API_KEY", "QDRANT_API_KEY")
COLLECTION = env_value("EVAL_QDRANT_COLLECTION", "QDRANT_COLLECTION", default="basic_german_benchmark") or "basic_german_benchmark"
CACHE_COLLECTION = (
    env_value("EVAL_QDRANT_CACHE_COLLECTION", "QDRANT_CACHE_COLLECTION", default="basic_german_eval_cache")
    or "basic_german_eval_cache"
)


class BenchmarkError(RuntimeError):
    pass


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def sha256_bytes(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def verify_golden() -> list[dict[str, Any]]:
    if not LOCK.exists():
        raise BenchmarkError("missing evals/golden.lock")
    expected = LOCK.read_text(encoding="utf-8").split()[0]
    actual = sha256_bytes(GOLDEN)
    if actual != expected:
        raise BenchmarkError(f"golden hash mismatch: expected {expected}, got {actual}")
    cases = [json.loads(line) for line in GOLDEN.read_text(encoding="utf-8").splitlines() if line]
    if len(cases) != 80:
        raise BenchmarkError(f"golden set must contain 80 items, found {len(cases)}")
    splits = Counter(case.get("split") for case in cases)
    if splits.get("dev") != 60 or splits.get("holdout") != 20:
        raise BenchmarkError(f"golden split must be 60/20 dev/holdout, found {dict(splits)}")
    return cases


def load_chunks() -> list[dict[str, Any]]:
    data = json.loads(SECTIONS.read_text(encoding="utf-8"))
    chunks = data["chunks"]
    by_id = Counter(chunk["id"] for chunk in chunks)
    duplicates = [chunk_id for chunk_id, count in by_id.items() if count > 1]
    if duplicates:
        raise BenchmarkError(f"duplicate chunk ids: {duplicates[:5]}")
    return chunks


def validate_required_sections(cases: list[dict[str, Any]], chunks: list[dict[str, Any]]) -> None:
    sections = {chunk["section_path"] for chunk in chunks}
    missing: dict[str, list[str]] = {}
    for case in cases:
        if not case.get("answerable", True):
            continue
        absent = [section for section in case["required_sections"] if section not in sections]
        if absent:
            missing[case["id"]] = absent
    if missing:
        raise BenchmarkError(f"golden required_sections not present in chunk manifest: {missing}")


def cache_file(kind: str, key: str) -> Path:
    path = CACHE / kind / f"{key}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def cached_embedding(text: str, input_type: str) -> list[float] | None:
    key = embedding_cache_key(text, input_type)
    path = cache_file("embeddings", key)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))["embedding"]
    return None


def save_embedding(text: str, input_type: str, embedding: list[float]) -> None:
    key = embedding_cache_key(text, input_type)
    cache_file("embeddings", key).write_text(
        json.dumps({"model": COHERE_MODEL, "input_type": input_type, "embedding": embedding}),
        encoding="utf-8",
    )


def embedding_cache_key(text: str, input_type: str) -> str:
    return text_hash(f"{COHERE_MODEL}\n{input_type}\n{text}")


def cohere_embed_batch(texts: list[str], input_type: str) -> list[list[float]]:
    api_key = os.getenv("COHERE_API_KEY")
    if not api_key:
        try:
            from app.core.config import get_settings

            api_key = get_settings().cohere_api_key
        except Exception:
            api_key = None
    if not api_key:
        raise BenchmarkError("COHERE_API_KEY is not configured")
    response = requests.post(
        "https://api.cohere.com/v2/embed",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "texts": texts,
            "model": COHERE_MODEL,
            "input_type": input_type,
            "embedding_types": ["float"],
        },
        timeout=60,
    )
    if response.status_code >= 400:
        raise BenchmarkError(f"Cohere embed failed {response.status_code}: {response.text[:300]}")
    vectors = response.json().get("embeddings", {}).get("float")
    if not isinstance(vectors, list):
        raise BenchmarkError("Cohere embed response missing float embeddings")
    for vector in vectors:
        if len(vector) != COHERE_DIM:
            raise BenchmarkError(f"embedding dimension mismatch: {len(vector)}")
    return vectors


def get_embeddings(texts: list[str], input_type: str) -> list[list[float]]:
    output: list[list[float] | None] = [cached_embedding(text, input_type) for text in texts]
    missing = [index for index, vector in enumerate(output) if vector is None]
    for offset in range(0, len(missing), 96):
        indexes = missing[offset : offset + 96]
        vectors = cohere_embed_batch([texts[index] for index in indexes], input_type)
        for index, vector in zip(indexes, vectors, strict=True):
            save_embedding(texts[index], input_type, vector)
            output[index] = vector
    return [vector for vector in output if vector is not None]


def vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in vector) + "]"


TOKEN_RE = re.compile(r"[\wäöüÄÖÜß]+", re.UNICODE)


def lexical_tokens(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_RE.findall(text) if len(token) > 1]


def sparse_vector(text: str) -> dict[str, list[int] | list[float]]:
    counts = Counter(lexical_tokens(text))
    indices: list[int] = []
    values: list[float] = []
    for token, count in counts.items():
        indices.append(int(hashlib.sha256(token.encode("utf-8")).hexdigest()[:8], 16))
        values.append(1.0 + math.log(count))
    ordered = sorted(zip(indices, values), key=lambda pair: pair[0])
    return {"indices": [index for index, _ in ordered], "values": [value for _, value in ordered]}


def is_local_qdrant() -> bool:
    return QDRANT_URL.startswith(("http://127.0.0.1", "http://localhost", "https://127.0.0.1", "https://localhost"))


def allow_remote_qdrant_recreate() -> bool:
    return (env_value("EVAL_ALLOW_REMOTE_QDRANT_RECREATE", default="") or "").lower() in {"1", "true", "yes"}


def qdrant(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if QDRANT_API_KEY:
        headers["api-key"] = QDRANT_API_KEY
    response = requests.request(method, f"{QDRANT_URL}{path}", json=payload, headers=headers, timeout=60)
    if response.status_code >= 400:
        raise BenchmarkError(f"Qdrant {method} {path} failed {response.status_code}: {response.text[:500]}")
    if response.text:
        return response.json()
    return {}


def qdrant_memory_bytes() -> int:
    try:
        result = qdrant("GET", f"/collections/{COLLECTION}")
        payload = result.get("result", {})
        return int(payload.get("vectors_count") or payload.get("points_count") or 0) * COHERE_DIM * 4
    except Exception:
        return 0


def qdrant_collection_names() -> list[str]:
    data = qdrant("GET", "/collections")
    return [item.get("name", "") for item in data.get("result", {}).get("collections", [])]


def ensure_qdrant_vector_collection(collection: str) -> None:
    if collection in qdrant_collection_names():
        return
    qdrant(
        "PUT",
        f"/collections/{collection}",
        {"vectors": {"size": COHERE_DIM, "distance": "Cosine"}},
    )


def stable_point_id(cache_key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"deutschelearn:eval-cache:{cache_key}"))


def cached_vector_by_key(cache_key: str) -> list[float] | None:
    path = CACHE / "embeddings" / f"{cache_key}.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    embedding = data.get("embedding")
    if not isinstance(embedding, list) or len(embedding) != COHERE_DIM:
        raise BenchmarkError(f"invalid cached embedding in {path}")
    return embedding


def build_cache_points(cases: list[dict[str, Any]], chunks: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    points: list[dict[str, Any]] = []
    missing = Counter()
    seen: set[str] = set()

    for chunk in chunks:
        cache_key = embedding_cache_key(chunk["content"], "search_document")
        vector = cached_vector_by_key(cache_key)
        if vector is None:
            missing["document"] += 1
            continue
        seen.add(cache_key)
        points.append(
            {
                "id": stable_point_id(cache_key),
                "vector": vector,
                "payload": {
                    "kind": "chunk",
                    "model": COHERE_MODEL,
                    "input_type": "search_document",
                    "cache_key": cache_key,
                    "chunk_id": chunk["id"],
                    "section_path": chunk["section_path"],
                    "content_hash": chunk["content_hash"],
                    "pages": chunk["pages"],
                    "part": chunk["part"],
                    "text": chunk["content"],
                },
            }
        )

    for case in cases:
        cache_key = embedding_cache_key(case["question"], "search_query")
        vector = cached_vector_by_key(cache_key)
        if vector is None:
            missing["query"] += 1
            continue
        seen.add(cache_key)
        points.append(
            {
                "id": stable_point_id(cache_key),
                "vector": vector,
                "payload": {
                    "kind": "golden_query",
                    "model": COHERE_MODEL,
                    "input_type": "search_query",
                    "cache_key": cache_key,
                    "item_id": case["id"],
                    "split": case["split"],
                    "answerable": case["answerable"],
                    "lang": case["lang"],
                    "required_sections": case["required_sections"],
                    "text": case["question"],
                },
            }
        )

    orphan_count = 0
    cache_dir = CACHE / "embeddings"
    if cache_dir.exists():
        for path in cache_dir.glob("*.json"):
            cache_key = path.stem
            if cache_key in seen:
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            vector = data.get("embedding")
            if not isinstance(vector, list) or len(vector) != COHERE_DIM:
                continue
            orphan_count += 1
            points.append(
                {
                    "id": stable_point_id(cache_key),
                    "vector": vector,
                    "payload": {
                        "kind": "orphan_cache_entry",
                        "model": data.get("model", COHERE_MODEL),
                        "input_type": data.get("input_type", "unknown"),
                        "cache_key": cache_key,
                    },
                }
            )

    return points, {"missing_document": missing["document"], "missing_query": missing["query"], "orphan": orphan_count}


def upload_cache_to_qdrant(cases: list[dict[str, Any]], chunks: list[dict[str, Any]], collection: str) -> dict[str, Any]:
    ensure_qdrant_vector_collection(collection)
    points, counts = build_cache_points(cases, chunks)
    for offset in range(0, len(points), 64):
        qdrant(
            "PUT",
            f"/collections/{collection}/points?wait=true",
            {"points": points[offset : offset + 64]},
        )
    count_data = qdrant("POST", f"/collections/{collection}/points/count", {"exact": True})
    stored_count = count_data.get("result", {}).get("count")
    return {
        "collection": collection,
        "uploaded_points": len(points),
        "stored_points": stored_count,
        **counts,
    }


def pg_memory_bytes(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute("select pg_total_relation_size('grammar_chunks')")
        return int(cur.fetchone()[0])


def seed_pg(chunks: list[dict[str, Any]], vectors: list[list[float]]) -> float:
    start = time.perf_counter()
    with psycopg.connect(PG_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute("create extension if not exists vector with schema extensions")
            cur.execute("drop index if exists grammar_chunks_embedding_hnsw_benchmark")
            cur.execute("delete from grammar_chunks where document_id = 'basic-german-benchmark'")
            cur.execute("delete from grammar_documents where id = 'basic-german-benchmark'")
            cur.execute(
                """
                insert into grammar_documents
                    (id, title, level, topic, source_path, source_kind, metadata_json,
                     content_hash, created_at, updated_at)
                values
                    ('basic-german-benchmark', 'Basic German', 'mixed', 'grammar',
                     'dev/BasicGerman.pdf', 'pdf', '{}', %s, now(), now())
                """,
                (sha256_bytes(PDF_PATH()),),
            )
            for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True)):
                title = chunk["section_path"].split(" > ")[-1][:200]
                metadata = json.dumps({"section_path": chunk["section_path"], "part": chunk["part"]})
                cur.execute(
                    """
                    insert into grammar_chunks
                        (id, document_id, title, section, level, topic, source_path, source_kind,
                         page_start, page_end, metadata_json, content, content_hash, sort_order,
                         embedding, created_at, updated_at)
                    values
                        (%s, 'basic-german-benchmark', %s, %s, 'mixed', 'grammar',
                         'dev/BasicGerman.pdf', 'pdf', %s, %s, %s, %s, %s, %s,
                         cast(%s as extensions.vector), now(), now())
                    """,
                    (
                        chunk["id"],
                        title,
                        chunk["section_path"][:200],
                        chunk["pages"][0],
                        chunk["pages"][1],
                        metadata,
                        chunk["content"],
                        chunk["content_hash"],
                        index,
                        vector_literal(vector),
                    ),
                )
            cur.execute(
                "create index grammar_chunks_embedding_hnsw_benchmark "
                "on grammar_chunks using hnsw (embedding extensions.vector_cosine_ops)"
            )
    return time.perf_counter() - start


def PDF_PATH() -> Path:
    return ROOT / "dev" / "BasicGerman.pdf"


def seed_qdrant(chunks: list[dict[str, Any]], vectors: list[list[float]]) -> float:
    if not is_local_qdrant() and not allow_remote_qdrant_recreate():
        raise BenchmarkError(
            "refusing to recreate a remote Qdrant collection without "
            "EVAL_ALLOW_REMOTE_QDRANT_RECREATE=1"
        )
    start = time.perf_counter()
    qdrant("DELETE", f"/collections/{COLLECTION}")
    qdrant(
        "PUT",
        f"/collections/{COLLECTION}",
        {
            "vectors": {"dense": {"size": COHERE_DIM, "distance": "Cosine"}},
            "sparse_vectors": {"lexical": {"index": {"on_disk": False}}},
            "hnsw_config": {"m": 16, "ef_construct": 100},
        },
    )
    points = []
    for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True), start=1):
        points.append(
            {
                "id": index,
                "vector": {"dense": vector, "lexical": sparse_vector(chunk["content"])},
                "payload": {
                    "chunk_id": chunk["id"],
                    "section_path": chunk["section_path"],
                    "content": chunk["content"],
                    "part": chunk["part"],
                    "pages": chunk["pages"],
                },
            }
        )
    for offset in range(0, len(points), 64):
        qdrant(
            "PUT",
            f"/collections/{COLLECTION}/points?wait=true",
            {"points": points[offset : offset + 64]},
        )
    return time.perf_counter() - start


def pg_search(
    conn: psycopg.Connection,
    query: str,
    vector: list[float],
    *,
    limit: int,
    exact: bool = False,
    ef_search: int | None = None,
    hybrid: bool = False,
) -> tuple[list[dict[str, Any]], float]:
    vec = vector_literal(vector)
    start = time.perf_counter()
    with conn.cursor(row_factory=dict_row) as cur:
        if ef_search is not None:
            if ef_search <= 0:
                raise BenchmarkError("ef_search must be positive")
            cur.execute(f"set local hnsw.ef_search = {int(ef_search)}")
        if exact:
            cur.execute("set local enable_indexscan = off")
        if hybrid:
            cur.execute(
                """
                with dense as (
                    select id, section, content, metadata_json,
                           1 - (embedding OPERATOR(extensions.<=>) cast(%s as extensions.vector)) as score,
                           row_number() over (
                               order by embedding OPERATOR(extensions.<=>) cast(%s as extensions.vector)
                           ) as rank
                    from grammar_chunks
                    where document_id = 'basic-german-benchmark'
                    order by embedding OPERATOR(extensions.<=>) cast(%s as extensions.vector)
                    limit 20
                ),
                lexical as (
                    select id, section, content, metadata_json,
                           ts_rank_cd(
                               to_tsvector('german', coalesce(section, '') || ' ' || coalesce(content, '')),
                               plainto_tsquery('german', %s)
                           ) as score,
                           row_number() over (
                               order by ts_rank_cd(
                                   to_tsvector('german', coalesce(section, '') || ' ' || coalesce(content, '')),
                                   plainto_tsquery('german', %s)
                               ) desc
                           ) as rank
                    from grammar_chunks
                    where document_id = 'basic-german-benchmark'
                      and plainto_tsquery('german', %s) @@
                          to_tsvector('german', coalesce(section, '') || ' ' || coalesce(content, ''))
                    order by score desc
                    limit 20
                ),
                fused as (
                    select id, section, content, metadata_json, score, 1.0 / (%s + rank) as rrf from dense
                    union all
                    select id, section, content, metadata_json, score, 1.0 / (%s + rank) as rrf from lexical
                )
                select id, section, content, metadata_json, sum(rrf) as score
                from fused
                group by id, section, content, metadata_json
                order by score desc, id
                limit %s
                """,
                (vec, vec, vec, query, query, query, RRF_K, RRF_K, limit),
            )
        else:
            cur.execute(
                """
                select id, section, content, metadata_json,
                       1 - (embedding OPERATOR(extensions.<=>) cast(%s as extensions.vector)) as score
                from grammar_chunks
                where document_id = 'basic-german-benchmark'
                order by embedding OPERATOR(extensions.<=>) cast(%s as extensions.vector), id
                limit %s
                """,
                (vec, vec, limit),
            )
        rows = cur.fetchall()
    elapsed_ms = (time.perf_counter() - start) * 1000
    return [normalize_pg_row(row) for row in rows], elapsed_ms


def normalize_pg_row(row: dict[str, Any]) -> dict[str, Any]:
    meta = json.loads(row.get("metadata_json") or "{}")
    return {
        "chunk_id": row["id"],
        "section_path": meta.get("section_path", row["section"]),
        "content": row["content"],
        "score": float(row["score"]),
    }


def qdrant_query(
    query: str,
    vector: list[float],
    *,
    limit: int,
    exact: bool = False,
    ef_search: int | None = None,
    hybrid: bool = False,
) -> tuple[list[dict[str, Any]], float]:
    start = time.perf_counter()
    params: dict[str, Any] = {}
    if exact:
        params["exact"] = True
    if ef_search is not None:
        params["hnsw_ef"] = ef_search
    if hybrid:
        payload = {
            "prefetch": [
                {"query": vector, "using": "dense", "params": params or None, "limit": 20},
                {"query": sparse_vector(query), "using": "lexical", "limit": 20},
            ],
            "query": {"fusion": "rrf"},
            "limit": limit,
            "with_payload": True,
        }
    else:
        payload = {
            "query": vector,
            "using": "dense",
            "params": params or None,
            "limit": limit,
            "with_payload": True,
        }
    data = qdrant("POST", f"/collections/{COLLECTION}/points/query", payload)
    elapsed_ms = (time.perf_counter() - start) * 1000
    points = data.get("result", {}).get("points", data.get("result", []))
    rows = []
    for point in points:
        item = point.get("payload", {})
        rows.append(
            {
                "chunk_id": item["chunk_id"],
                "section_path": item["section_path"],
                "content": item["content"],
                "score": float(point.get("score", 0.0)),
            }
        )
    return rows, elapsed_ms


def hit_at(case: dict[str, Any], rows: list[dict[str, Any]], k: int) -> bool:
    if not case.get("answerable", True):
        return not rows
    required = set(case["required_sections"])
    return any(row["section_path"] in required for row in rows[:k])


def reciprocal_rank(case: dict[str, Any], rows: list[dict[str, Any]]) -> float:
    if not case.get("answerable", True):
        return 1.0 if not rows else 0.0
    required = set(case["required_sections"])
    for index, row in enumerate(rows, start=1):
        if row["section_path"] in required:
            return 1.0 / index
    return 0.0


def recall_at(case: dict[str, Any], rows: list[dict[str, Any]], k: int) -> float:
    required = set(case.get("required_sections") or [])
    if not required:
        return 1.0 if not rows else 0.0
    seen = {row["section_path"] for row in rows[:k]}
    return len(required & seen) / len(required)


def summarize(run_id: str, backend: str, config: str, cases: list[dict[str, Any]], results: dict[str, dict[str, Any]], *,
              exact_results: dict[str, list[str]] | None = None, build_s: float = 0.0, memory_bytes: int = 0) -> dict[str, Any]:
    metrics: dict[str, Any] = {}
    latencies = [results[case["id"]]["latency_ms"] for case in cases]
    metrics["p50_ms"] = round(statistics.median(latencies), 2)
    metrics["p95_ms"] = round(percentile(latencies, 95), 2)
    metrics["build_s"] = round(build_s, 3)
    metrics["memory_bytes"] = memory_bytes
    for k in K_VALUES:
        metrics[f"hit@{k}"] = round(sum(hit_at(case, results[case["id"]]["rows"], k) for case in cases) / len(cases), 4)
        metrics[f"recall@{k}"] = round(sum(recall_at(case, results[case["id"]]["rows"], k) for case in cases) / len(cases), 4)
    metrics["mrr"] = round(sum(reciprocal_rank(case, results[case["id"]]["rows"]) for case in cases) / len(cases), 4)
    if exact_results is not None:
        overlaps = []
        for case in cases:
            ids = [row["chunk_id"] for row in results[case["id"]]["rows"][:5]]
            exact_ids = exact_results[case["id"]][:5]
            overlaps.append(len(set(ids) & set(exact_ids)) / max(1, len(exact_ids)))
        metrics["recall_vs_exact@5"] = round(sum(overlaps) / len(overlaps), 4)
    append_notebook(
        {
            "timestamp": now_iso(),
            "commit": git_commit(),
            "run_id": run_id,
            "variant": {"backend": backend, "config": config},
            "split": cases[0]["split"] if cases else "unknown",
            "metrics": metrics,
            "reason": f"{config} benchmark for {backend}",
            "spend_usd": 0.0,
            "cumulative_spend_usd": cumulative_spend(),
        }
    )
    return metrics


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = (len(ordered) - 1) * (p / 100)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return ordered[low]
    return ordered[low] * (high - rank) + ordered[high] * (rank - low)


def append_notebook(entry: dict[str, Any]) -> None:
    NOTEBOOK.parent.mkdir(parents=True, exist_ok=True)
    with NOTEBOOK.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def append_per_item(records: list[dict[str, Any]]) -> None:
    PER_ITEM.parent.mkdir(parents=True, exist_ok=True)
    with PER_ITEM.open("a", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def cumulative_spend() -> float:
    if not NOTEBOOK.exists():
        return 0.0
    total = 0.0
    for line in NOTEBOOK.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            total += float(json.loads(line).get("spend_usd", 0.0))
        except Exception:
            continue
    if total > SPEND_CAP:
        raise BenchmarkError(f"spend cap exceeded: ${total:.2f}")
    return round(total, 4)


def git_commit() -> str:
    try:
        import subprocess

        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return "unknown"


def run_config(
    cases: list[dict[str, Any]],
    query_vectors: dict[str, list[float]],
    backend: str,
    config: str,
    *,
    conn: psycopg.Connection | None = None,
    exact: bool = False,
    ef_search: int | None = None,
    hybrid: bool = False,
    limit: int = 5,
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    run_id = f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%S')}-{backend}-{config}"
    results: dict[str, dict[str, Any]] = {}
    records: list[dict[str, Any]] = []
    for case in cases:
        if backend == "pgvector":
            assert conn is not None
            rows, latency_ms = pg_search(conn, case["question"], query_vectors[case["id"]], limit=limit, exact=exact, ef_search=ef_search, hybrid=hybrid)
        else:
            rows, latency_ms = qdrant_query(case["question"], query_vectors[case["id"]], limit=limit, exact=exact, ef_search=ef_search, hybrid=hybrid)
        results[case["id"]] = {"rows": rows, "latency_ms": latency_ms}
        records.append(
            {
                "timestamp": now_iso(),
                "run_id": run_id,
                "backend": backend,
                "config": config,
                "split": case["split"],
                "item_id": case["id"],
                "latency_ms": round(latency_ms, 3),
                "retrieved": [{"chunk_id": row["chunk_id"], "section_path": row["section_path"], "score": row["score"]} for row in rows],
                "hit@5": hit_at(case, rows, 5),
                "mrr": reciprocal_rank(case, rows),
            }
        )
    append_per_item(records)
    return results, records


def assert_r0(pg_results: dict[str, dict[str, Any]], qdrant_results: dict[str, dict[str, Any]], cases: list[dict[str, Any]]) -> None:
    mismatches = []
    for case in cases:
        pg_rows = pg_results[case["id"]]["rows"]
        q_rows = qdrant_results[case["id"]]["rows"]
        pg_ids = [row["chunk_id"] for row in pg_rows]
        q_ids = [row["chunk_id"] for row in q_rows]
        if pg_ids != q_ids:
            mismatches.append({"item_id": case["id"], "pgvector": pg_ids, "qdrant": q_ids})
            continue
        for pg_row, q_row in zip(pg_rows, q_rows, strict=True):
            if abs(pg_row["score"] - q_row["score"]) > 2e-4:
                mismatches.append(
                    {
                        "item_id": case["id"],
                        "chunk_id": pg_row["chunk_id"],
                        "pg_score": pg_row["score"],
                        "qdrant_score": q_row["score"],
                    }
                )
                break
    if mismatches:
        append_notebook(
            {
                "timestamp": now_iso(),
                "commit": git_commit(),
                "variant": {"name": "R0-exact-equivalence"},
                "split": cases[0]["split"],
                "metrics": {"passed": False, "mismatches": len(mismatches)},
                "reason": "R0 correctness gate",
                "failure": mismatches[:10],
                "spend_usd": 0.0,
                "cumulative_spend_usd": cumulative_spend(),
            }
        )
        raise BenchmarkError(f"R0 failed: {len(mismatches)} exact-search mismatches; first: {mismatches[0]}")
    append_notebook(
        {
            "timestamp": now_iso(),
            "commit": git_commit(),
            "variant": {"name": "R0-exact-equivalence"},
            "split": cases[0]["split"],
            "metrics": {"passed": True},
            "reason": "R0 correctness gate",
            "spend_usd": 0.0,
            "cumulative_spend_usd": cumulative_spend(),
        }
    )


def mc_nemar(cases: list[dict[str, Any]], left: dict[str, dict[str, Any]], right: dict[str, dict[str, Any]]) -> float:
    b = c = 0
    for case in cases:
        l_hit = hit_at(case, left[case["id"]]["rows"], 5)
        r_hit = hit_at(case, right[case["id"]]["rows"], 5)
        if l_hit and not r_hit:
            b += 1
        elif r_hit and not l_hit:
            c += 1
    n = b + c
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, i) for i in range(0, min(b, c) + 1)) / (2**n)
    return min(1.0, 2 * tail)


def bootstrap_delta(cases: list[dict[str, Any]], left: dict[str, dict[str, Any]], right: dict[str, dict[str, Any]]) -> tuple[float, float, float]:
    deltas = []
    rng = random.Random(20260921)
    values = [
        (reciprocal_rank(case, right[case["id"]]["rows"]) - reciprocal_rank(case, left[case["id"]]["rows"]))
        for case in cases
    ]
    observed = statistics.mean(values)
    for _ in range(10000):
        sample = [values[rng.randrange(len(values))] for _ in values]
        deltas.append(statistics.mean(sample))
    deltas.sort()
    return observed, deltas[250], deltas[9749]


def write_prereg() -> None:
    if PREREG.exists():
        return
    PREREG.write_text(
        json.dumps(
            {
                "timestamp": now_iso(),
                "comparison": "pgvector vs Qdrant",
                "final_configurations": {
                    "pgvector": "R1-default-hnsw",
                    "qdrant": "R1-default-hnsw",
                },
                "baseline": "R0 exact equivalence must pass before any quality comparison",
                "deciding_metrics": ["Hit@5", "MRR", "recall_vs_exact@5", "p95_latency_ms"],
                "success_criteria": (
                    "Recommend the backend with statistically separable retrieval quality; "
                    "if quality is indistinguishable, prefer lower latency/operational simplicity."
                ),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def write_report(context: dict[str, Any]) -> None:
    lines = [
        "# pgvector vs Qdrant Retrieval Benchmark",
        "",
        f"Generated: {now_iso()}",
        "",
        "## Corpus",
        "",
        f"- Source: `dev/BasicGerman.pdf`",
        f"- Chunks: {context['chunk_stats']['chunks']}",
        f"- Grammar points: {context['chunk_stats']['grammar_points']}",
        f"- Mean chars: {context['chunk_stats']['mean_chars']}",
        f"- Max chars: {context['chunk_stats']['max_chars']}",
        "",
        "## R0",
        "",
        f"Exact-search equivalence: {'passed' if context['r0_passed'] else 'failed'}",
        "",
        "## Retrieval Results",
        "",
        "| Split | Backend | Config | Recall vs exact@5 | Hit@5 | MRR | p50 ms | p95 ms | Build s | Memory bytes |",
        "|---|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in context["tables"]:
        metrics = row["metrics"]
        lines.append(
            f"| {row['split']} | {row['backend']} | {row['config']} | "
            f"{metrics.get('recall_vs_exact@5', '')} | {metrics.get('hit@5', '')} | {metrics.get('mrr', '')} | "
            f"{metrics.get('p50_ms', '')} | {metrics.get('p95_ms', '')} | {metrics.get('build_s', '')} | {metrics.get('memory_bytes', '')} |"
        )
    lines.extend(
        [
            "",
            "## Statistics",
            "",
            f"- Dev R1 McNemar p-value at Hit@5: {context['stats'].get('r1_mcnemar_hit5')}",
            f"- Dev R1 paired bootstrap delta MRR (Qdrant - pgvector): {context['stats'].get('r1_mrr_delta')}",
            "",
            "## Different Contexts",
            "",
            f"- Dev R1 different top-5 contexts: {context['different_contexts'].get('dev_r1', 'not run')}",
            f"- Hold-out R1 different top-5 contexts: {context['different_contexts'].get('holdout_r1', 'not run')}",
            "",
            "## Generation",
            "",
            "Generation and judge metrics were not run in this retrieval-only execution. The runner persists context differences so generation can be deduplicated by context in a later pass.",
            "",
            "## Recommendation",
            "",
            context["recommendation"],
            "",
            "## Limitations",
            "",
            "- Golden questions are section-level labels, so they measure whether the right grammar point is retrieved, not whether the answer wording is pedagogically ideal.",
            "- BasicGerman is a small single-PDF corpus; approximate-search differences are expected to be tiny once exact equivalence passes.",
            "- Generation effects remain unmeasured in this run.",
            f"- Total tracked spend: ${cumulative_spend():.2f}.",
            "",
        ]
    )
    REPORT.write_text("\n".join(lines), encoding="utf-8")


def compare_contexts(cases: list[dict[str, Any]], left: dict[str, dict[str, Any]], right: dict[str, dict[str, Any]]) -> int:
    count = 0
    for case in cases:
        left_ids = [row["chunk_id"] for row in left[case["id"]]["rows"][:5]]
        right_ids = [row["chunk_id"] for row in right[case["id"]]["rows"][:5]]
        if left_ids != right_ids:
            count += 1
    return count


def command_prepare(_args: argparse.Namespace) -> None:
    import importlib.util

    extractor_path = ROOT / "scripts" / "extract_basic_german_eval.py"
    spec = importlib.util.spec_from_file_location("extract_basic_german_eval", extractor_path)
    if spec is None or spec.loader is None:
        raise BenchmarkError(f"could not load extractor from {extractor_path}")
    extractor = importlib.util.module_from_spec(spec)
    import sys

    sys.modules[spec.name] = extractor
    spec.loader.exec_module(extractor)

    extractor.main()
    cases = verify_golden()
    chunks = load_chunks()
    validate_required_sections(cases, chunks)
    vectors = get_embeddings([chunk["content"] for chunk in chunks], "search_document")
    seed_pg(chunks, vectors)
    seed_qdrant(chunks, vectors)
    print(json.dumps({"prepared_chunks": len(chunks), "golden_cases": len(cases)}, indent=2))


def command_run(args: argparse.Namespace) -> None:
    cases_all = verify_golden()
    chunks = load_chunks()
    validate_required_sections(cases_all, chunks)
    split = "holdout" if args.final else "dev"
    if args.final and not PREREG.exists():
        raise BenchmarkError("final hold-out run requires evals/preregistration.json")
    cases = [case for case in cases_all if case["split"] == split]
    vectors = get_embeddings([chunk["content"] for chunk in chunks], "search_document")
    query_vectors_list = get_embeddings([case["question"] for case in cases], "search_query")
    query_vectors = {case["id"]: vector for case, vector in zip(cases, query_vectors_list, strict=True)}
    pg_build = seed_pg(chunks, vectors)
    q_build = seed_qdrant(chunks, vectors)
    section_data = json.loads(SECTIONS.read_text(encoding="utf-8"))
    tables: list[dict[str, Any]] = []
    stats: dict[str, Any] = {}
    different_contexts: dict[str, Any] = {}

    with psycopg.connect(PG_DSN) as conn:
        pg_exact, _ = run_config(cases, query_vectors, "pgvector", "R0-exact", conn=conn, exact=True, limit=5)
        q_exact, _ = run_config(cases, query_vectors, "qdrant", "R0-exact", exact=True, limit=5)
        assert_r0(pg_exact, q_exact, cases)
        exact_ids = {case["id"]: [row["chunk_id"] for row in pg_exact[case["id"]]["rows"]] for case in cases}

        pg_mem = pg_memory_bytes(conn)
        q_mem = qdrant_memory_bytes()
        pg_r1, _ = run_config(cases, query_vectors, "pgvector", "R1-default-hnsw", conn=conn, limit=5)
        q_r1, _ = run_config(cases, query_vectors, "qdrant", "R1-default-hnsw", limit=5)
        tables.append({"split": split, "backend": "pgvector", "config": "R1-default-hnsw", "metrics": summarize("R1-pg", "pgvector", "R1-default-hnsw", cases, pg_r1, exact_results=exact_ids, build_s=pg_build, memory_bytes=pg_mem)})
        tables.append({"split": split, "backend": "qdrant", "config": "R1-default-hnsw", "metrics": summarize("R1-qdrant", "qdrant", "R1-default-hnsw", cases, q_r1, exact_results=exact_ids, build_s=q_build, memory_bytes=q_mem)})
        stats["r1_mcnemar_hit5"] = round(mc_nemar(cases, pg_r1, q_r1), 6)
        delta = bootstrap_delta(cases, pg_r1, q_r1)
        stats["r1_mrr_delta"] = {"observed": round(delta[0], 4), "ci95": [round(delta[1], 4), round(delta[2], 4)]}
        different_contexts[f"{split}_r1"] = compare_contexts(cases, pg_r1, q_r1)

        if not args.final:
            for ef in EF_SWEEP:
                pg_ef, _ = run_config(cases, query_vectors, "pgvector", f"R2-ef-{ef}", conn=conn, ef_search=ef, limit=5)
                q_ef, _ = run_config(cases, query_vectors, "qdrant", f"R2-ef-{ef}", ef_search=ef, limit=5)
                tables.append({"split": split, "backend": "pgvector", "config": f"R2-ef-{ef}", "metrics": summarize(f"R2-pg-{ef}", "pgvector", f"R2-ef-{ef}", cases, pg_ef, exact_results=exact_ids, memory_bytes=pg_mem)})
                tables.append({"split": split, "backend": "qdrant", "config": f"R2-ef-{ef}", "metrics": summarize(f"R2-q-{ef}", "qdrant", f"R2-ef-{ef}", cases, q_ef, exact_results=exact_ids, memory_bytes=q_mem)})
            pg_hybrid, _ = run_config(cases, query_vectors, "pgvector", "R3-hybrid-rrf", conn=conn, hybrid=True, limit=5)
            q_hybrid, _ = run_config(cases, query_vectors, "qdrant", "R3-hybrid-rrf", hybrid=True, limit=5)
            tables.append({"split": split, "backend": "pgvector", "config": "R3-hybrid-rrf", "metrics": summarize("R3-pg", "pgvector", "R3-hybrid-rrf", cases, pg_hybrid, memory_bytes=pg_mem)})
            tables.append({"split": split, "backend": "qdrant", "config": "R3-hybrid-rrf", "metrics": summarize("R3-q", "qdrant", "R3-hybrid-rrf", cases, q_hybrid, memory_bytes=q_mem)})
            write_prereg()

    recommendation = "Quality was not separable at R1 if R0 passes and recall-vs-exact is 1.0 for both; prefer pgvector unless Qdrant shows a clear latency or operations need."
    if args.final:
        recommendation = "Hold-out was run once under the preregistered R1 pgvector-vs-Qdrant comparison; interpret any small quality difference through the paired statistics above."
    write_report(
        {
            "chunk_stats": section_data["stats"],
            "r0_passed": True,
            "tables": tables,
            "stats": stats,
            "different_contexts": different_contexts,
            "recommendation": recommendation,
        }
    )
    print(json.dumps({"split": split, "tables": tables, "stats": stats, "report": str(REPORT)}, indent=2))


def command_upload_cache(args: argparse.Namespace) -> None:
    cases = verify_golden()
    chunks = load_chunks()
    validate_required_sections(cases, chunks)
    result = upload_cache_to_qdrant(cases, chunks, args.collection)
    append_notebook(
        {
            "timestamp": now_iso(),
            "commit": git_commit(),
            "variant": {"backend": "qdrant", "config": "upload-evals-cache", "collection": args.collection},
            "split": "all",
            "metrics": result,
            "reason": "Persist evals/cache embeddings to Qdrant",
            "spend_usd": 0.0,
            "cumulative_spend_usd": cumulative_spend(),
        }
    )
    print(json.dumps(result, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("prepare")
    run = sub.add_parser("run")
    run.add_argument("--final", action="store_true")
    upload_cache = sub.add_parser("upload-cache")
    upload_cache.add_argument("--collection", default=CACHE_COLLECTION)
    args = parser.parse_args()
    if args.command == "prepare":
        command_prepare(args)
    elif args.command == "upload-cache":
        command_upload_cache(args)
    else:
        command_run(args)


if __name__ == "__main__":
    main()
