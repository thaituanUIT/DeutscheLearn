"""add story group and part

Revision ID: 2f8b6d0e6c1f
Revises: d92643fc766c
Create Date: 2026-08-22 10:12:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2f8b6d0e6c1f"
down_revision: str | Sequence[str] | None = "d92643fc766c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("reading_passages")}
    if "group" not in columns:
        op.add_column(
            "reading_passages",
            sa.Column("group", sa.String(length=40), server_default="general", nullable=False),
        )
        op.alter_column("reading_passages", "group", server_default=None)
    if "part" not in columns:
        op.add_column("reading_passages", sa.Column("part", sa.String(length=40), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("reading_passages")}
    if "part" in columns:
        op.drop_column("reading_passages", "part")
    if "group" in columns:
        op.drop_column("reading_passages", "group")
