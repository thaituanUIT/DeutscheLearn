#!/bin/sh
set -eu

uv run --no-sync alembic upgrade head
exec uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
