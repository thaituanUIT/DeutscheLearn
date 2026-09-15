"""add grammar question logs

Revision ID: 9b1f6a2d4c8e
Revises: 3f4b7a9c2d11
Create Date: 2026-09-15 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9b1f6a2d4c8e"
down_revision: str | Sequence[str] | None = "3f4b7a9c2d11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "grammar_question_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("learner_id", sa.String(length=120), nullable=True),
        sa.Column("normalized_question", sa.Text(), nullable=False),
        sa.Column("retrieval_query", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("context_type", sa.String(length=40), nullable=True),
        sa.Column("route", sa.String(length=80), nullable=True),
        sa.Column("cited_chunk_ids_json", sa.Text(), nullable=False),
        sa.Column("retrieval_debug_json", sa.Text(), nullable=True),
        sa.Column("cached", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_grammar_question_logs_context_type"), "grammar_question_logs", ["context_type"])
    op.create_index(op.f("ix_grammar_question_logs_learner_id"), "grammar_question_logs", ["learner_id"])
    op.create_index(op.f("ix_grammar_question_logs_route"), "grammar_question_logs", ["route"])
    op.create_index(op.f("ix_grammar_question_logs_status"), "grammar_question_logs", ["status"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_grammar_question_logs_status"), table_name="grammar_question_logs")
    op.drop_index(op.f("ix_grammar_question_logs_route"), table_name="grammar_question_logs")
    op.drop_index(op.f("ix_grammar_question_logs_learner_id"), table_name="grammar_question_logs")
    op.drop_index(op.f("ix_grammar_question_logs_context_type"), table_name="grammar_question_logs")
    op.drop_table("grammar_question_logs")
