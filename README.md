# DeutscheLearn

Anonymous German language learning app with multiple learning modes.

## Features

- Cookie-based anonymous player identity.
- Random generated display names.
- Multiple learning modes: flashcards, Goethe-Institut styled exercises, and grammar assistant.
- Modular TypeScript frontend with Vite.
- FastAPI backend with SQLAlchemy.
- Render deployment config with Supabase Postgres.

## Local Development

Install dependencies:

```bash
uv sync --locked
npm install --prefix frontend
```

Run the backend:

```bash
uv run uvicorn app.main:app --reload
```

Run the frontend dev server:

```bash
npm run dev --prefix frontend
```

For a production-style local run:

```bash
uv sync --locked --no-dev
npm run build --prefix frontend
uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Production installs use `uv sync --locked --no-dev` to skip local-only tooling such as tests,
crawling, and PDF ingestion. Use the default `uv sync --locked` for development.

## Environment

```text
DATABASE_URL=sqlite:///./quiz.db
COOKIE_SECURE=false
COOKIE_SAMESITE=lax
SEED_ON_STARTUP=true
COHERE_API_KEY=
COHERE_EMBEDDING_MODEL=embed-multilingual-v3.0
COHERE_EMBEDDING_DIMENSION=1024
OPENROUTER_API_KEY=
OPENROUTER_CHAT_MODEL=google/gemma-4-31b-it:free
```

On Render, use the included `render.yaml`. It provisions a web service plus Postgres and sets `COOKIE_SECURE=true`.

Do not run production with the default SQLite URL. Render web service disks are ephemeral, so
`sqlite:///./quiz.db` can disappear on a new deploy. Create the service from `render.yaml`, or
manually provision a Render Postgres database and set the web service `DATABASE_URL` environment
variable to that database connection string. The app refuses to start in `ENVIRONMENT=production`
when `DATABASE_URL` still points to SQLite.

## Database Migrations

Schema changes are managed with Alembic:

```bash
uv run alembic upgrade head
uv run alembic revision --autogenerate -m "describe schema change"
```

For a fresh Supabase database, set `DATABASE_URL` to the Supabase Postgres connection string
with SSL enabled, then run:

```bash
DATABASE_URL="postgresql://..." uv run alembic upgrade head
```

## Grammar RAG

The grammar assistant uses a Render-friendly split:

- Render serves the public API and widget only.
- Curated Markdown notes live in `data/grammar`.
- Source PDFs live in local `data/grammar_pdfs` and are described by `data/grammar_sources.json`.
- Local/dev ingestion embeds notes with Cohere `embed-multilingual-v3.0` and writes chunks to the
  same Supabase Postgres database used by `DATABASE_URL`.
- OpenRouter generates answers with `google/gemma-4-31b-it:free`.

The embedding model is pinned to Cohere `embed-multilingual-v3.0` at 1024 dimensions. Changing
the model is a schema migration plus full re-embed, not an environment-only change.

Set `DATABASE_URL` to the Supabase Postgres URL, run migrations there, then ingest:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run alembic upgrade head
UV_CACHE_DIR=/tmp/uv-cache uv run python scripts/ingest_grammar.py --changed-only
```

PDF ingestion uses `pymupdf4llm` locally and fails fast when a PDF appears scanned or produces
too little text. Add PDFs to `data/grammar_pdfs`, then add entries to `data/grammar_sources.json`:

```json
[
  {
    "id": "a2-grammar-book",
    "title": "A2 Grammar Book",
    "level": "A2",
    "topic": "praeposition_dativ",
    "path": "a2-grammar-book.pdf",
    "source": "private-pdf",
    "pages": [12, 18]
  }
]
```

Useful ingestion commands:

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run python scripts/ingest_grammar.py --source-kind pdf --extract-only
UV_CACHE_DIR=/tmp/uv-cache uv run python scripts/ingest_grammar.py --source-kind pdf --changed-only
UV_CACHE_DIR=/tmp/uv-cache uv run python scripts/ingest_grammar.py --source-kind all --changed-only --delete-missing
```

Use `--dry-run` to inspect chunk ids and `--delete-missing` after removing corpus files. Ingestion
must not run on Render free tier. `data/grammar_pdfs/` is gitignored by default.

Run the retrieval harness with:

```bash
npm run eval
```

The current golden set is a starter set and should grow toward roughly 60 items. Before relying
on an LLM judge for answer quality, hand-score 20 generation outputs and record the agreement
rate here.

The app still creates missing tables on startup for local development, but production database
schema changes should be applied with Alembic before deploying application code that depends on
them.

## GitHub Actions and Render

The workflow in `.github/workflows/render-deploy.yml` runs backend linting, backend tests,
frontend audit, and frontend build on pull requests and pushes to `main`.

For Render deploys you have two options:

1. Enable Render's normal GitHub auto-deploy for the service. Render will build from
   `render.yaml` after each push to `main`.
2. Or create a Render deploy hook and save it as a GitHub Actions secret named
   `RENDER_DEPLOY_HOOK_URL`. The workflow will trigger that hook only after the build job passes.
