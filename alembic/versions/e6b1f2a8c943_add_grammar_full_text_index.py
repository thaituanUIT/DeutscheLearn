"""add full-text index for grammar chunk search

Revision ID: e6b1f2a8c943
Revises: c4e2a1d7b903
Create Date: 2026-10-31 00:05:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e6b1f2a8c943"
down_revision: str | Sequence[str] | None = "c4e2a1d7b903"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_GRAMMAR_TEXT = (
    "to_tsvector('simple', coalesce(title, '') || ' ' || "
    "coalesce(section, '') || ' ' || coalesce(content, ''))"
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "create index if not exists ix_grammar_chunks_full_text "
            f"on grammar_chunks using gin ({_GRAMMAR_TEXT})"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("drop index if exists ix_grammar_chunks_full_text")
