"""make grammar assistant global

Revision ID: 3f4b7a9c2d11
Revises: 1c9f3d8b0e71
Create Date: 2026-08-25 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3f4b7a9c2d11"
down_revision: str | Sequence[str] | None = "1c9f3d8b0e71"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    is_postgresql = bind.dialect.name == "postgresql"

    if is_postgresql:
        op.execute(
            """
            delete from grammar_answer_cache cache
            using grammar_answer_cache newer
            where cache.question_hash = newer.question_hash
              and (
                newer.created_at > cache.created_at
                or (newer.created_at = cache.created_at and newer.id > cache.id)
              )
            """
        )
    else:
        op.execute(
            """
            delete from grammar_answer_cache
            where id not in (
                select id
                from (
                    select
                        id,
                        row_number() over (
                            partition by question_hash
                            order by created_at desc, id desc
                        ) as row_index
                    from grammar_answer_cache
                )
                where row_index = 1
            )
            """
        )

    with op.batch_alter_table("grammar_answer_cache") as batch_op:
        batch_op.drop_index(op.f("ix_grammar_answer_cache_level"))
        batch_op.drop_constraint("uq_grammar_answer_cache_question_level", type_="unique")
        batch_op.create_unique_constraint(
            "uq_grammar_answer_cache_question_hash",
            ["question_hash"],
        )
        batch_op.drop_column("level")


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("grammar_answer_cache") as batch_op:
        batch_op.add_column(sa.Column("level", sa.String(length=8), nullable=False, server_default="A1"))
        batch_op.create_index(op.f("ix_grammar_answer_cache_level"), ["level"])
        batch_op.drop_constraint("uq_grammar_answer_cache_question_hash", type_="unique")
        batch_op.create_unique_constraint(
            "uq_grammar_answer_cache_question_level",
            ["question_hash", "level"],
        )
        batch_op.alter_column("level", server_default=None)
