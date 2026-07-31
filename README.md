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
