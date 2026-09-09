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
STATIC_ASSETS_ENABLED=true
```

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

The workflow in `.github/workflows/render-deploy.yml` runs backend checks and frontend build on pull requests and pushes to `main`. If `RENDER_DEPLOY_HOOK_URL` is configured, it triggers a Render deploy after successful checks.

## Static Assets

The backend serves `/assets/*` from `frontend/dist/assets` when assets exist. In production, missing built assets cause startup failure so broken deployments fail early.
