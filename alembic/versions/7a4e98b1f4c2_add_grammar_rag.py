"""add grammar rag

Revision ID: 7a4e98b1f4c2
Revises: 5c2b7e8a9d10
Create Date: 2026-08-25 12:00:00.000000

Embedding model is pinned before first vector migration:
Cohere embed-multilingual-v3.0, 1024 dimensions.
Changing this model or dimension requires rebuilding grammar_chunks.embedding
and re-embedding the corpus.

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7a4e98b1f4c2"
down_revision: str | Sequence[str] | None = "5c2b7e8a9d10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    is_postgresql = bind.dialect.name == "postgresql"

    if is_postgresql:
        op.execute("create extension if not exists vector with schema extensions")

    op.create_table(
        "grammar_documents",
        sa.Column("id", sa.String(length=120), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("level", sa.String(length=8), nullable=False),
        sa.Column("topic", sa.String(length=120), nullable=False),
        sa.Column("source_path", sa.String(length=500), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_grammar_documents_level"), "grammar_documents", ["level"])
    op.create_index(op.f("ix_grammar_documents_topic"), "grammar_documents", ["topic"])

    op.create_table(
        "grammar_chunks",
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("document_id", sa.String(length=120), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("section", sa.String(length=200), nullable=False),
        sa.Column("level", sa.String(length=8), nullable=False),
        sa.Column("topic", sa.String(length=120), nullable=False),
        sa.Column("source_path", sa.String(length=500), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["grammar_documents.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_grammar_chunks_content_hash"), "grammar_chunks", ["content_hash"])
    op.create_index(op.f("ix_grammar_chunks_document_id"), "grammar_chunks", ["document_id"])
    op.create_index(op.f("ix_grammar_chunks_level"), "grammar_chunks", ["level"])
    op.create_index(op.f("ix_grammar_chunks_topic"), "grammar_chunks", ["topic"])

    if is_postgresql:
        op.execute(
            "alter table grammar_chunks "
            "add column embedding extensions.vector(1024)"
        )
    else:
        op.add_column("grammar_chunks", sa.Column("embedding", sa.Text(), nullable=True))

    op.create_table(
        "grammar_answer_cache",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("question_hash", sa.String(length=64), nullable=False),
        sa.Column("level", sa.String(length=8), nullable=False),
        sa.Column("normalized_question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("citations_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "question_hash",
            "level",
            name="uq_grammar_answer_cache_question_level",
        ),
    )
    op.create_index(op.f("ix_grammar_answer_cache_level"), "grammar_answer_cache", ["level"])
    op.create_index(
        op.f("ix_grammar_answer_cache_question_hash"),
        "grammar_answer_cache",
        ["question_hash"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_grammar_answer_cache_question_hash"), table_name="grammar_answer_cache")
    op.drop_index(op.f("ix_grammar_answer_cache_level"), table_name="grammar_answer_cache")
    op.drop_table("grammar_answer_cache")
    op.drop_index(op.f("ix_grammar_chunks_topic"), table_name="grammar_chunks")
    op.drop_index(op.f("ix_grammar_chunks_level"), table_name="grammar_chunks")
    op.drop_index(op.f("ix_grammar_chunks_document_id"), table_name="grammar_chunks")
    op.drop_index(op.f("ix_grammar_chunks_content_hash"), table_name="grammar_chunks")
    op.drop_table("grammar_chunks")
    op.drop_index(op.f("ix_grammar_documents_topic"), table_name="grammar_documents")
    op.drop_index(op.f("ix_grammar_documents_level"), table_name="grammar_documents")
    op.drop_table("grammar_documents")
