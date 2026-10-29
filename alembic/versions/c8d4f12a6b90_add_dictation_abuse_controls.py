"""add dictation abuse controls

Revision ID: c8d4f12a6b90
Revises: a7c31f9d42e0
Create Date: 2026-10-29 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c8d4f12a6b90"
down_revision: str | Sequence[str] | None = "a7c31f9d42e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "dictation_videos",
        sa.Column("report_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "dictation_videos",
        sa.Column("is_hidden", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_index("ix_dictation_videos_is_hidden", "dictation_videos", ["is_hidden"])
    op.create_table(
        "dictation_fetch_counters",
        sa.Column("bucket_key", sa.String(length=100), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("bucket_key"),
    )
    op.create_index(
        "ix_dictation_fetch_counters_updated_at", "dictation_fetch_counters", ["updated_at"]
    )
    op.create_table(
        "dictation_video_reports",
        sa.Column("video_id", sa.String(length=11), nullable=False),
        sa.Column("reporter_key", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["video_id"], ["dictation_videos.video_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("video_id", "reporter_key"),
    )
    op.create_index(
        "ix_dictation_video_reports_created_at", "dictation_video_reports", ["created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_dictation_video_reports_created_at", table_name="dictation_video_reports")
    op.drop_table("dictation_video_reports")
    op.drop_index("ix_dictation_fetch_counters_updated_at", table_name="dictation_fetch_counters")
    op.drop_table("dictation_fetch_counters")
    op.drop_index("ix_dictation_videos_is_hidden", table_name="dictation_videos")
    op.drop_column("dictation_videos", "is_hidden")
    op.drop_column("dictation_videos", "report_count")
