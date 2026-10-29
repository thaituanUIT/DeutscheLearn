# Data And Deployment

This app uses FastAPI, SQLAlchemy, Alembic, Vite, and either SQLite for local development or Postgres for persistent environments.

## Local Setup

Install dependencies:

```bash
uv sync --locked
npm install --prefix frontend
```

Run the backend:

```bash
uv run uvicorn app.main:app --reload
```

Run the frontend:

```bash
npm run dev --prefix frontend
```

Build frontend assets:

```bash
npm run build --prefix frontend
```

## Environment

Common settings:

```text
DATABASE_URL=sqlite:///./quiz.db
ENVIRONMENT=development
COOKIE_SECURE=false
COOKIE_SAMESITE=lax
SEED_ON_STARTUP=true
ADMIN_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
COHERE_API_KEY=
OPENROUTER_API_KEY=
WEBSHARE_PROXY_USERNAME=
WEBSHARE_PROXY_PASSWORD=
STATIC_ASSETS_ENABLED=true
```

Set both Webshare values to enable rotating residential proxies for YouTube caption requests.
The existing `PROXY_USERNAME` and `PROXY_PASSWORD` names are also accepted. The app uses the
library's default retry count for blocked proxies. Keep the credentials in the environment and
never commit them. If only one value is set, dictation returns a configuration error instead of
silently sending requests without the proxy.

Dictation abuse controls apply only to new transcript fetches; cached videos remain available.
Defaults allow 3 new videos per client per hour, 10 per client per day, and 10 globally per day,
with a 500-video library cap and transcript limits of 20,000 characters / 500 segments. Public
reports hide a video after three distinct client IPs report it. An admin can review reports at
`GET /api/admin/dictation/reports` and restore a video with
`PATCH /api/admin/dictation/videos/{video_id}` using `Authorization: Bearer <ADMIN_TOKEN>` and
`{"is_hidden": false}`. All limits are configurable through `DICTATION_*` environment settings.

Production must not use SQLite. The app rejects `ENVIRONMENT=production` when `DATABASE_URL` points to SQLite.

## Seeding

When `SEED_ON_STARTUP=true`, startup runs:

- base word seeding from `app/services/words.py`
- focus CSV import from `data/focus_words.csv`
- starter reading passage import from `data/story_passages.json`

Reading passage seeding only runs when no stimulus rows exist.

## Migrations

Apply migrations:

```bash
uv run alembic upgrade head
```

Create a migration:

```bash
uv run alembic revision --autogenerate -m "describe schema change"
```

For Supabase or Render Postgres:

```bash
DATABASE_URL="postgresql://..." uv run alembic upgrade head
```

## Tests And Checks

Backend tests:

```bash
uv run pytest
```

Frontend build:

```bash
npm run build --prefix frontend
```

Grammar eval summary:

```bash
npm run eval
```

## Render

`render.yaml` defines the production web service and Postgres database. Render should build frontend assets before starting the FastAPI app.

Important production settings:

- `ENVIRONMENT=production`
- `COOKIE_SECURE=true`
- persistent Postgres `DATABASE_URL`
- configured API keys for optional provider-backed features

## GitHub Actions

The workflow in `.github/workflows/render-deploy.yml` runs backend checks and the frontend build on pushes to `main`. Render's GitHub auto-deploy performs the deployment; the workflow does not call a deploy hook, preventing duplicate deploys for the same commit.

## Static Assets

The backend serves `/assets/*` from `frontend/dist/assets` when assets exist. In production, missing built assets cause startup failure so broken deployments fail early.
