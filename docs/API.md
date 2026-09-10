# API

The backend is a FastAPI application in `app/main.py`. All JSON API routes are mounted under `/api` from `app/api/routes.py`. The same FastAPI app also serves the Vite SPA from `frontend/dist` when built.

## Application Startup

Startup uses the app lifespan hook in `app/main.py`:

- creates missing tables with SQLAlchemy metadata for local development
- seeds base words from `app/services/words.py`
- imports focus vocabulary from `data/focus_words.csv`
- imports starter reading passages from `data/story_passages.json`

Production schema changes should still be applied with Alembic before deploying.

## Public Endpoints

Core:

- `GET /api/health`
- `GET /api/players/me`
- `GET /api/word-of-the-day`

Focus vocabulary:

- `GET /api/focus/levels`
- `GET /api/focus/topics?level=A1`
- `GET /api/focus/topic-aliases`
- `GET /api/focus/cards?level=A1&topic=food_drink`
- `GET /api/focus/revision?level=A1&topic=food_drink`

Reading and Goethe exercises:

- `GET /api/story/groups`
- `GET /api/story/levels?group=general`
- `GET /api/story/parts?level=A2`
- `GET /api/story/passages`
- `GET /api/story/passages/{passage_id}`
- `POST /api/story/answer`

Quiz:

- `POST /api/quiz/endless/start`
- `POST /api/quiz/endless/answer`
- `POST /api/quiz/practice/start`
- `POST /api/quiz/practice/answer`
- `POST /api/quiz/timed/start`
- `POST /api/quiz/timed/answer`
- `GET /api/leaderboard?mode=endless`

Grammar assistant:

- `POST /api/grammar/ask`

## Anonymous Player Identity

Anonymous identity uses the `anon_player_id` HTTP-only cookie. `GET /api/players/me` creates a player when the cookie is missing. Quiz endpoints require an existing player cookie and return `401` if the player has not been initialized.

Cookie settings are controlled by:

- `COOKIE_SECURE`
- `COOKIE_SAMESITE`
- `COOKIE_MAX_AGE_SECONDS`

## Admin Authentication

Admin routes require:

```text
Authorization: Bearer {ADMIN_TOKEN}
```

If `ADMIN_TOKEN` is not configured, admin routes return `503`. Invalid tokens return `401`.

## Error Behavior

Common API errors:

- `401`: missing or invalid anonymous player/admin credentials
- `404`: requested attempt, question, answer, word, or passage does not exist
- `409`: attempt already finished, question already answered, duplicate word, or malformed content state
- `422`: request validation failure
- `429`: grammar assistant rate limit
- `502`: upstream grammar provider failure
- `503`: unavailable admin or grammar configuration
