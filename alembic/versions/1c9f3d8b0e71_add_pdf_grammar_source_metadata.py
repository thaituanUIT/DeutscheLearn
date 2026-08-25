"""add pdf grammar source metadata

Revision ID: 1c9f3d8b0e71
Revises: 7a4e98b1f4c2
Create Date: 2026-08-25 13:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1c9f3d8b0e71"
down_revision: str | Sequence[str] | None = "7a4e98b1f4c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "grammar_documents",
        sa.Column("source_kind", sa.String(length=20), nullable=False, server_default="markdown"),
    )
    op.add_column("grammar_documents", sa.Column("metadata_json", sa.Text(), nullable=True))
    op.alter_column("grammar_documents", "source_kind", server_default=None)

    op.add_column(
        "grammar_chunks",
        sa.Column("source_kind", sa.String(length=20), nullable=False, server_default="markdown"),
    )
    op.add_column("grammar_chunks", sa.Column("page_start", sa.Integer(), nullable=True))
    op.add_column("grammar_chunks", sa.Column("page_end", sa.Integer(), nullable=True))
    op.add_column("grammar_chunks", sa.Column("metadata_json", sa.Text(), nullable=True))
    op.alter_column("grammar_chunks", "source_kind", server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("grammar_chunks", "metadata_json")
    op.drop_column("grammar_chunks", "page_end")
    op.drop_column("grammar_chunks", "page_start")
    op.drop_column("grammar_chunks", "source_kind")
    op.drop_column("grammar_documents", "metadata_json")
    op.drop_column("grammar_documents", "source_kind")
