# German Word Quiz

Anonymous German word quiz with an endless mode leaderboard.

## Features

- Cookie-based anonymous player identity.
- Random generated display names.
- Server-validated endless quiz attempts.
- Leaderboard for best endless streaks.
- Modular TypeScript frontend with Vite.
- FastAPI backend with SQLAlchemy.
- Render deployment config with Postgres.

## Local Development

Install dependencies:

```bash
uv sync
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
npm run build --prefix frontend
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Environment

```text
DATABASE_URL=sqlite:///./quiz.db
COOKIE_SECURE=false
COOKIE_SAMESITE=lax
SEED_ON_STARTUP=true
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
