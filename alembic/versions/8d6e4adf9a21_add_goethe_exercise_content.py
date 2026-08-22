"""add goethe exercise content

Revision ID: 8d6e4adf9a21
Revises: 2f8b6d0e6c1f
Create Date: 2026-08-22 10:45:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8d6e4adf9a21"
down_revision: str | Sequence[str] | None = "2f8b6d0e6c1f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("reading_passages", sa.Column("exercise_type", sa.String(length=80), nullable=True))
    op.add_column("reading_passages", sa.Column("content_json", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("reading_passages", "content_json")
    op.drop_column("reading_passages", "exercise_type")
