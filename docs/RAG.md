# Grammar RAG

This project uses a small, resource-conscious RAG pipeline for the grammar assistant. The system keeps Cohere `embed-multilingual-v3.0` embeddings pinned at 1024 dimensions and improves retrieval quality with better chunk construction, metadata, cache-aware ingestion, and lightweight hybrid ranking.

## Goals

- Keep runtime and ingestion costs low.
- Preserve the existing Cohere embedding model and pgvector schema.
- Improve retrieval quality before changing prompts or chat models.
- Make failures diagnosable through retrieval debug output and golden cases.

## Architecture

1. Source grammar notes live in `data/grammar/*.md` and optional PDF sources listed in `data/grammar_sources.json`.
2. `scripts/ingest_grammar.py` parses documents into structure-aware chunks.
3. Chunks are embedded with Cohere using `input_type="search_document"`.
4. Embeddings and metadata are stored in `grammar_chunks`.
5. User questions are embedded with Cohere using `input_type="search_query"`.
6. `app/services/grammar.py` retrieves vector candidates from Postgres pgvector.
7. The service gathers up to 24 vector matches and up to 24 independent full-text matches. It combines their ranks with reciprocal-rank fusion:

```text
rrf_score = 1 / (60 + vector_rank) + 1 / (60 + keyword_rank)
```

8. The service applies the configured semantic threshold and sends only the accepted top chunks to the chat model.

## Chunking

Markdown documents are split by top-level headings. Long sections are split on paragraph boundaries instead of fixed character boundaries. This keeps normal chunk IDs stable while allowing oversized sections to become smaller, searchable chunks.

PDF documents preserve page markers and page ranges when available. Page metadata is exposed in citations and labels.

Each chunk stores:

- `title`
- `section`
- `level`
- `topic`
- `source_path`
- `source_kind`
- `page_start` / `page_end`
- `metadata_json`
- `content_hash`
- `sort_order`

The text sent to Cohere includes document title and section heading before the chunk body:

```text
{title}
{section}
{content}
```

That gives embeddings enough local context without increasing the stored answer context.

## Ingestion

Run a dry run first:

```bash
uv run python scripts/ingest_grammar.py --dry-run
```

Ingest only changed chunks:

```bash
uv run python scripts/ingest_grammar.py --changed-only
```

Delete chunks that no longer exist in the source corpus:

```bash
uv run python scripts/ingest_grammar.py --changed-only --delete-missing
```

When `--source-kind` is `markdown` or `pdf`, `--delete-missing` only removes stale chunks of that source kind. It refuses to run if extraction produces no chunks. An ingestion run also clears cached answers so responses and citations reflect the refreshed corpus.

Useful source filters:

```bash
uv run python scripts/ingest_grammar.py --source-kind markdown
uv run python scripts/ingest_grammar.py --source-kind pdf
```

`--changed-only` compares the generated chunk IDs and content hashes against existing rows. This avoids re-embedding unchanged content and keeps Cohere usage low.

## Retrieval

The runtime retrieval path is intentionally cheap:

- retrieve vector candidates and full-text candidates independently
- combine candidate ranks with reciprocal-rank fusion
- order by the fused score, using semantic similarity to break ties
- reject short or vague queries before retrieval
- apply `GRAMMAR_SIMILARITY_THRESHOLD`
- drop chunks below `GRAMMAR_RELATIVE_SIMILARITY_THRESHOLD` times the top raw similarity score
- cap accepted chunks at six after filtering and deduplication
- send at most six citations to the chat model

PostgreSQL deployments create an HNSW cosine index on `grammar_chunks.embedding` and a GIN full-text index on title, section, and content through Alembic migrations. Runtime ordering uses cosine distance and the indexed `simple` text configuration.

This is not a heavy cross-encoder reranker. It is a low-cost way to recover exact grammar terms and article forms that do not land in the vector top 24.

## Configuration

Relevant settings are in `app/core/config.py`:

- `COHERE_API_KEY`
- `COHERE_EMBEDDING_MODEL=embed-multilingual-v3.0`
- `COHERE_EMBEDDING_DIMENSION=1024`
- `OPENROUTER_API_KEY`
- `OPENROUTER_CHAT_MODEL`
- `GRAMMAR_SIMILARITY_THRESHOLD`
- `GRAMMAR_RELATIVE_SIMILARITY_THRESHOLD`
- `GRAMMAR_MIN_QUERY_WORDS`
- `GRAMMAR_RATE_LIMIT_PER_HOUR`

The Cohere model and dimension are intentionally pinned. Changing either requires a schema migration and a full corpus re-embed.

## Evaluation

The locked backend-comparison set lives in `evals/golden.jsonl`. Threshold calibration uses learner-style cases in `evals/learner_questions.jsonl` by default, with expected source sections and answer points.

Run the current eval summary:

```bash
uv run python scripts/eval_grammar.py
```

The eval accepts `required_sections` labels from the learner cases (matching retrieved section labels) and legacy `required_chunks` IDs. It sweeps absolute floors and records the selected calibration in `evals/results.json`.
The current choice is `GRAMMAR_SIMILARITY_THRESHOLD=0.45` with
`GRAMMAR_RELATIVE_SIMILARITY_THRESHOLD=0.85`, calibrated against Cohere
`embed-multilingual-v3.0` at 1024 dimensions. Changing the embedding model invalidates this
calibration.

Generate answer-review packets with each expected point and retrieved passage beside the model output:

```bash
uv run python scripts/eval_grammar_answers.py
```

Review `evals/answer_review.jsonl` for unsupported claims, missing expected points, and mismatched sources. This uses the configured Cohere and OpenRouter services; it is separate from the retrieval-only calibration.

Run focused tests for the RAG pieces:

```bash
uv run pytest tests/test_grammar_service.py tests/test_grammar_ingestion.py
```

Recommended retrieval metrics:

- `Recall@5`
- `MRR`
- full-hit rate for multi-chunk questions
- abstain rate for unanswerable questions

Generated answers include numbered source references that match the expandable citation chips in the widget. The current retrieval calibration does not score answer faithfulness; use `expected_points` as the basis for a separate human or model-judged generation evaluation before changing prompts or models.

Evaluate retrieval separately from answer generation. If the expected chunks are missing, fix ingestion or retrieval before changing the prompt.

## Resource Limits

The current design avoids expensive additions:

- no local embedding model download
- no cross-encoder reranker
- no second vector index
- no full-context stuffing
- no re-embedding unchanged chunks

If quality plateaus, consider these upgrades in order:

1. Expand the golden set to at least 50 real questions.
2. Tune `GRAMMAR_SIMILARITY_THRESHOLD`.
3. Tune the semantic and keyword weights.
4. Add metadata filters only when the UI exposes explicit filters.
5. Add a small reranker only if retrieval metrics show ordering problems after hybrid ranking.
