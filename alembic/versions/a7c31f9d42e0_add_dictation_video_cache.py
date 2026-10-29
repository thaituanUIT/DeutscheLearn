"""add dictation video transcript cache

Revision ID: a7c31f9d42e0
Revises: 9b1f6a2d4c8e
Create Date: 2026-10-29 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7c31f9d42e0"
down_revision: str | Sequence[str] | None = "9b1f6a2d4c8e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "dictation_videos",
        sa.Column("video_id", sa.String(length=11), nullable=False),
        sa.Column("video_url", sa.String(length=2048), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("author_name", sa.String(length=255), nullable=True),
        sa.Column("thumbnail_url", sa.String(length=1000), nullable=True),
        sa.Column("language", sa.String(length=100), nullable=False),
        sa.Column("is_generated", sa.Boolean(), nullable=False),
        sa.Column("segments", sa.JSON(), nullable=False),
        sa.Column("segment_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("video_id"),
    )
    op.create_index(
        op.f("ix_dictation_videos_created_at"),
        "dictation_videos",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_dictation_videos_created_at"), table_name="dictation_videos")
    op.drop_table("dictation_videos")
