"""add HNSW index for grammar chunk embeddings

Revision ID: c4e2a1d7b903
Revises: c8d4f12a6b90
Create Date: 2026-10-31 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4e2a1d7b903"
down_revision: str | Sequence[str] | None = "c8d4f12a6b90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "create index if not exists ix_grammar_chunks_embedding_hnsw "
            "on grammar_chunks using hnsw "
            "(embedding extensions.vector_cosine_ops)"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("drop index if exists ix_grammar_chunks_embedding_hnsw")
