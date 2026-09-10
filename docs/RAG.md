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
7. Retrieved candidates are reranked with a lightweight hybrid score:

```text
hybrid_score = semantic_similarity * 0.70 + keyword_score * 0.30
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

Useful source filters:

```bash
uv run python scripts/ingest_grammar.py --source-kind markdown
uv run python scripts/ingest_grammar.py --source-kind pdf
```

`--changed-only` compares the generated chunk IDs and content hashes against existing rows. This avoids re-embedding unchanged content and keeps Cohere usage low.

## Retrieval

The runtime retrieval path is intentionally cheap:

- retrieve the top vector candidates from pgvector
- compute PostgreSQL full-text rank over `title`, `section`, and `content`
- combine semantic and keyword scores
- order by the hybrid score
- reject short or vague queries before retrieval
- apply `GRAMMAR_SIMILARITY_THRESHOLD`
- drop chunks below `GRAMMAR_RELATIVE_SIMILARITY_THRESHOLD` times the top raw similarity score
- cap accepted chunks at six after filtering and deduplication
- send at most six citations to the chat model

This is not a heavy cross-encoder reranker. It is a low-cost precision improvement for exact grammar terms, article forms, and short learner questions.

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

Golden retrieval cases live in `evals/golden.jsonl`.

Run the current eval summary:

```bash
uv run python scripts/eval_grammar.py
```

The eval sweeps absolute floors and records the selected calibration in `evals/results.json`.
The current choice is `GRAMMAR_SIMILARITY_THRESHOLD=0.45` with
`GRAMMAR_RELATIVE_SIMILARITY_THRESHOLD=0.85`, calibrated against Cohere
`embed-multilingual-v3.0` at 1024 dimensions. Changing the embedding model invalidates this
calibration.

Run focused tests for the RAG pieces:

```bash
uv run pytest tests/test_grammar_service.py tests/test_grammar_ingestion.py
```

Recommended retrieval metrics:

- `Recall@5`
- `MRR`
- full-hit rate for multi-chunk questions
- abstain rate for unanswerable questions

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
