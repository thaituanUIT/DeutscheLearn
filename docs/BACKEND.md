# Backend Guide

This document is the entry point for understanding and changing the DeutscheLearn backend. It
describes the runtime architecture, module boundaries, persistence model, request lifecycle,
configuration, and development workflow. Endpoint-level and feature-specific details remain in
the linked documents under `docs/`.

## Technology Stack

- Python 3.11+
- FastAPI 0.116
- Pydantic v2 and `pydantic-settings`
- SQLAlchemy 2 using synchronous sessions
- Alembic migrations
- SQLite for local development and tests
- PostgreSQL 16 with pgvector for production and grammar retrieval
- Cohere embeddings and OpenRouter chat completion for grammar RAG
- Supabase Storage for optional stimulus image uploads

Dependencies and tool configuration live in `pyproject.toml`. `uv.lock` pins the resolved Python
environment.

## System Context

The repository supports two deployment shapes.

Local monolith:

```text
Browser
   |
   v
FastAPI :8000
   |-- /api/*                  JSON API
   |-- /assets/*               built Vite assets
   `-- /*                      SPA fallback
          |
          v
      SQLite or PostgreSQL
```

Split Docker stack:

```text
Browser
   |
   v
Nginx frontend :8000
   |-- /api/* --------------> FastAPI backend :8000
   `-- /*                      Vite SPA
                                  |
                                  v
                            PostgreSQL + pgvector
                                  |
                    +-------------+-------------+
                    |                           |
                 Cohere                    OpenRouter
```

In Docker, only Nginx publishes a host port. The backend is reachable on the `app` network, while
PostgreSQL is isolated on the internal `private` network.

## Source Layout

| Path | Responsibility |
| --- | --- |
| `app/main.py` | FastAPI construction, lifespan startup, static assets, and SPA fallback |
| `app/api/routes.py` | `/api` route handlers, HTTP errors, transactions, and response assembly |
| `app/api/deps.py` | Database dependency and anonymous-player cookie dependencies |
| `app/core/config.py` | Typed environment configuration and startup invariants |
| `app/core/time.py` | UTC time helper used by persistence code |
| `app/db/session.py` | Engine, session factory, base model, and request-scoped session |
| `app/db/models.py` | SQLAlchemy tables and relationships |
| `app/schemas.py` | Pydantic request and response contracts plus content validation |
| `app/services/quiz.py` | Quiz question selection and answer-choice generation |
| `app/services/focus.py` | Focus CSV import and flashcard/revision queries |
| `app/services/story.py` | Reading import, querying, and answer lookup |
| `app/services/goethe_reading.py` | Goethe level/part formats and exercise rules |
| `app/services/grammar.py` | Grammar RAG query, retrieval, filtering, generation, cache, and rate limit |
| `app/services/words.py` | Base vocabulary, word of the day, and Duden fallback |
| `app/services/names.py` | Anonymous display-name generation |
| `alembic/versions/` | Ordered database schema changes |
| `scripts/` | Grammar ingestion, evaluation, and manual word seeding |
| `tests/` | API, configuration, ingestion, and RAG service tests |

The current API is intentionally centralized in `app/api/routes.py`. New code should keep route
handlers focused on HTTP concerns and place reusable domain behavior in the matching service
module.

## Application Startup

`app.main:create_app` creates the application and mounts the `/api` router. Its lifespan hook does
the following:

1. Calls `Base.metadata.create_all` to make missing mapped tables available for local development.
2. When `SEED_ON_STARTUP=true`, inserts base words.
3. Imports focus vocabulary from `data/focus_words.csv`.
4. Imports starter reading content from `data/story_passages.json` when appropriate.

`create_all` is a local convenience, not a production migration strategy. It cannot reliably
apply constraints, column changes, or the raw pgvector column. Production startup must run:

```bash
uv run alembic upgrade head
```

The backend Docker entrypoint runs that command before Uvicorn.

## Request Lifecycle

A typical JSON request follows this path:

1. FastAPI matches a route under `/api`.
2. Pydantic validates path, query, header, cookie, and body values.
3. Dependencies open a SQLAlchemy `Session` and resolve player or admin access when required.
4. The route calls a service function or performs state-transition checks.
5. The route commits successful writes or returns an HTTP error.
6. A declared response model serializes the public representation.
7. `get_db` closes the request session.

The application uses synchronous SQLAlchemy and synchronous route handlers. FastAPI executes these
handlers in its worker thread pool, including provider-backed grammar requests.

## Identity And Access

### Anonymous learner

`GET /api/players/me` uses `get_or_create_player`. It creates an `AnonymousPlayer` when needed and
sets an HTTP-only `anon_player_id` cookie. Quiz start and answer routes use `require_player`, which
returns `401` if the cookie is missing or no longer maps to a player.

Cookie behavior is controlled by `COOKIE_SECURE`, `COOKIE_SAMESITE`, and
`COOKIE_MAX_AGE_SECONDS`. Production HTTPS deployments should use `COOKIE_SECURE=true`.

### Administrator

Admin routes use a bearer token:

```http
Authorization: Bearer <ADMIN_TOKEN>
```

The token comparison uses `secrets.compare_digest`. An unconfigured admin token produces `503`;
an invalid token produces `401`. `ADMIN_KEY` is supported only as a legacy fallback.

There are no administrator accounts, sessions, roles, or password-reset flows. Treat the token as
a deployment secret and rotate it through the hosting secret store.

### Grammar debug data

`POST /api/grammar/ask` accepts `include_debug`, but retrieval diagnostics are returned only when
the same request also carries a valid admin bearer token.

## Persistence Model

### Learners and quizzes

| Table | Purpose |
| --- | --- |
| `anonymous_players` | Anonymous identity, display name, total games, and best endless score |
| `quiz_attempts` | Mode, score, accuracy, status, start/end times, and finish reason |
| `quiz_attempt_questions` | Immutable question snapshot plus selected answer and result |

Quiz answers are validated against the choices stored with the attempt question. This prevents a
client from submitting an arbitrary value or answering the same question twice.

### Vocabulary and focus content

| Table | Purpose |
| --- | --- |
| `word` | Canonical lemma, article, part of speech, and meaning |
| `topic` | Stable topic name and slug |
| `word_focus` | Many-to-many assignment of a word to a CEFR level and topic |

The unique key on `word_focus` prevents duplicate word/level/topic assignments. Flashcard review
dates are currently stored by the frontend, not by a backend review table.

### Reading content

| Table | Purpose |
| --- | --- |
| `stimulus` | General or Goethe passage, advert, notice, or structured visual content |
| `item` | A question attached to a stimulus |
| `item_option` | Answer option and optional reference to another stimulus |
| `upload` | Signed image-upload path, ownership, and deferred-deletion metadata |

`item.correct_option_id` is the source of truth for correctness. A referenced stimulus lets an
option point to an advert or other visual source without duplicating it.

Goethe constraints are shared through `app/services/goethe_reading.py`. Input validation rejects
parts or answer formats that do not match the selected A1-B2 model-test structure.

### Grammar RAG

| Table | Purpose |
| --- | --- |
| `grammar_documents` | Source-level metadata and content hash |
| `grammar_chunks` | Searchable chunks, source metadata, and a migration-managed vector column |
| `grammar_answer_cache` | Answer and citation cache keyed by normalized question and context |
| `grammar_question_logs` | Retrieval query, status, context type, route, citations, and cache usage |

The `grammar_chunks.embedding` column is created by Alembic as
`extensions.vector(1024)` on PostgreSQL. It is intentionally queried with SQL in the RAG service
rather than mapped as a normal SQLAlchemy field.

## Major Backend Flows

### Quiz state transitions

- Endless mode creates another question only after a correct answer. A wrong answer finishes the
  attempt and updates the player's best score.
- Practice mode records every answer and always creates the next question.
- Timed mode enforces a 60-second server-side deadline and finishes an expired attempt.
- Finished attempts reject further answers with `409`.
- The leaderboard ranks each player's best finished attempt for endless or timed mode.

See [QUIZ.md](QUIZ.md) for response behavior and scoring details.

### Reading answers

Public passage responses omit correctness. `POST /api/story/answer` verifies that both the question
and selected option belong to the expected content before returning correctness and explanation.
Draft stimuli are kept out of learner-facing lists.

See [READING.md](READING.md) for the content model and Goethe exercise shapes.

### Admin content writes

Admin word and reading endpoints validate Pydantic input, update SQLAlchemy relationships, and
commit as one request transaction. Bulk imports support a preview path that performs validation
without writing. A committed import writes only when the submitted collection is valid.

See [ADMIN.md](ADMIN.md) for payload shape, validation rules, and upload behavior.

### Grammar RAG request

`POST /api/grammar/ask` performs this sequence:

1. Apply a process-local hourly limit by request IP and optional learner ID.
2. Normalize the question and add structured wrong-answer or passage context to retrieval.
3. Reject queries that are too short or vague.
4. Check the context-aware answer cache.
5. Embed the retrieval query with Cohere `search_query`.
6. Retrieve 24 pgvector candidates, add PostgreSQL full-text rank, and return the top 12 hybrid
   candidates.
7. Apply absolute and relative similarity floors, term checks, conflict checks, deduplication, and
   a six-citation cap.
8. Generate a grounded answer through OpenRouter.
9. Cache the answer and citations.
10. Best-effort log the question and retrieval outcome for later data analysis.

The rate limiter is in process memory. Multiple backend workers do not share counters, and a
restart clears them. Use Redis or a database-backed limiter before treating it as a distributed
abuse-control system.

Grammar retrieval requires PostgreSQL with pgvector. SQLite supports the rest of local development
and the test suite, but grammar retrieval reports `503` there.

See [RAG.md](RAG.md) for ingestion, ranking, evaluation, and tuning.

## External Services

| Service | Used for | Failure behavior |
| --- | --- | --- |
| Duden | Word of the day and fallback meaning lookup | Falls back to seeded/local data |
| Cohere | Document and query embeddings | Grammar endpoint returns `503` or `502` |
| OpenRouter | Grounded grammar answer generation | Tries configured fallback models, then fails |
| Supabase Storage | Signed stimulus image uploads and public URLs | Upload endpoint returns `503` when unconfigured |

Provider keys never belong in frontend environment variables or committed `.env` files.

## API Discovery

All JSON routes use the `/api` prefix. The concise endpoint inventory and shared error behavior are
in [API.md](API.md).

When running FastAPI directly, interactive OpenAPI documentation is available at:

```text
http://127.0.0.1:8000/docs
http://127.0.0.1:8000/openapi.json
```

The split Nginx configuration proxies `/api/`, not `/docs`, so these development URLs require
direct backend access.

## Configuration

Settings are loaded from environment variables and an optional repository-root `.env` file.

### Runtime and persistence

| Variable | Default | Notes |
| --- | --- | --- |
| `APP_NAME` | `DeutscheLearn` | OpenAPI application title |
| `DATABASE_URL` | `sqlite:///./quiz.db` | Production must use persistent PostgreSQL |
| `ENVIRONMENT` | `development` | `production` rejects SQLite |
| `STATIC_ASSETS_ENABLED` | `true` | Disabled for the split backend container |
| `SEED_ON_STARTUP` | `true` | Enables idempotent local seed/import work |
| `COOKIE_SECURE` | `false` | Set true behind production HTTPS |
| `COOKIE_SAMESITE` | `lax` | Anonymous identity cookie policy |
| `COOKIE_MAX_AGE_SECONDS` | `31536000` | One year |
| `ADMIN_TOKEN` | empty | Required by admin endpoints |
| `ADMIN_KEY` | empty | Legacy fallback only |

### Storage and RAG

| Variable | Default | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | empty | Required for signed stimulus uploads |
| `SUPABASE_SERVICE_ROLE_KEY` | empty | Backend-only storage credential |
| `COHERE_API_KEY` | empty | Required for embedding |
| `COHERE_EMBEDDING_MODEL` | `embed-multilingual-v3.0` | Pinned by startup validation |
| `COHERE_EMBEDDING_DIMENSION` | `1024` | Pinned by schema and startup validation |
| `OPENROUTER_API_KEY` | empty | Required for generation |
| `OPENROUTER_CHAT_MODEL` | `google/gemma-4-31b-it:free` | Preferred generation model |
| `OPENROUTER_CHAT_FALLBACK_MODELS` | `openrouter/free` | Comma-separated fallback order |
| `OPENROUTER_HTTP_REFERER` | empty | Optional provider attribution |
| `OPENROUTER_APP_TITLE` | `DeutscheLearn` | Provider attribution title |
| `GRAMMAR_RATE_LIMIT_PER_HOUR` | `10` | Per process, IP and learner key |
| `GRAMMAR_SIMILARITY_THRESHOLD` | `0.45` | Absolute semantic floor |
| `GRAMMAR_RELATIVE_SIMILARITY_THRESHOLD` | `0.85` | Floor relative to the top candidate |
| `GRAMMAR_MIN_QUERY_WORDS` | `3` | Vague-query guard |

Changing the embedding model or dimension requires a migration and full grammar-corpus re-embed.

## Local Development

Install dependencies:

```bash
uv sync --locked
```

Apply migrations and run the backend:

```bash
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

The Vite development server proxies `/api` to `http://localhost:8000`.

Useful focused commands:

```bash
uv run pytest tests/test_quiz_api.py
uv run pytest tests/test_grammar_service.py tests/test_grammar_ingestion.py
uv run ruff check app tests scripts
```

## Database Migrations

Create a migration after changing mapped models:

```bash
uv run alembic revision --autogenerate -m "describe the change"
```

Review every generated migration before applying it. pgvector setup and the embedding column use
explicit SQL, so autogenerate does not understand the complete RAG schema.

Apply or inspect migration state:

```bash
uv run alembic upgrade head
uv run alembic current
uv run alembic history
```

Avoid relying on downgrade in production as a data-recovery strategy. Back up persistent data and
prefer a forward repair migration for destructive or data-transforming changes.

## Docker Operation

Start the split stack:

```bash
docker compose up --build
```

The default URL is `http://localhost:8000`. Override the published port with `APP_PORT`:

```bash
APP_PORT=8080 docker compose up --build
```

Set deployment secrets through the prefixed Compose inputs, including:

```text
DEUTSCHELEARN_POSTGRES_PASSWORD
DEUTSCHELEARN_ADMIN_TOKEN
DEUTSCHELEARN_COHERE_API_KEY
DEUTSCHELEARN_OPENROUTER_API_KEY
```

The PostgreSQL volume is named `postgres_data`. Removing that volume deletes local container data.
See [DATA_AND_DEPLOYMENT.md](DATA_AND_DEPLOYMENT.md) before changing networks, volumes, or startup
commands.

## Testing Strategy

`tests/conftest.py` configures a temporary SQLite database before importing the application. The
suite covers:

- configuration invariants
- anonymous-player, quiz, leaderboard, focus, reading, and admin API behavior
- Goethe model-format validation
- grammar query construction, filtering, caching, and provider error paths
- grammar source parsing and stable ingestion behavior

Provider calls are mocked in tests. Real retrieval quality is measured separately with the golden
cases in `evals/golden.jsonl`:

```bash
uv run python scripts/eval_grammar.py
```

Before opening a backend pull request, run:

```bash
uv run ruff check app tests scripts
uv run pytest
```

If the API contract affects the frontend, also run:

```bash
npm run build --prefix frontend
```

## Error And Logging Conventions

Use `HTTPException` at the route boundary for expected client or configuration errors. Current
status conventions are:

- `401` missing learner identity or invalid admin token
- `404` resource does not exist or does not belong to the current learner
- `409` invalid state transition or duplicate resource
- `422` invalid request or answer choice
- `429` grammar request limit reached
- `502` upstream provider returned an invalid/failing response
- `503` required backend capability is not configured or available

Unexpected provider and logging failures use Python logging. Grammar question logging is
best-effort: a log-write failure rolls back that write and does not replace a successful learner
answer with an error.

## Adding Backend Functionality

For a new endpoint or domain operation:

1. Add or update the Pydantic contract in `app/schemas.py`.
2. Add reusable domain logic to the appropriate `app/services/` module.
3. Keep authentication, HTTP mapping, transaction ownership, and response assembly in the route.
4. Add SQLAlchemy models and an Alembic migration when persistence changes.
5. Add API tests for success, ownership/authentication, validation, and invalid state transitions.
6. Update the appropriate feature document and [API.md](API.md).

Do not expose ORM objects directly as an accidental API contract. Explicit response models keep
correct answers, internal IDs, debug fields, and provider metadata from leaking to public clients.

