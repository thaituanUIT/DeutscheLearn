"""Record dictation hide and restore decisions.

Revision ID: b02e7d943a10
Revises: e6b1f2a8c943
"""

import sqlalchemy as sa

from alembic import op

revision = "b02e7d943a10"
down_revision = "e6b1f2a8c943"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dictation_moderation_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "video_id",
            sa.String(11),
            sa.ForeignKey("dictation_videos.video_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("is_hidden", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_dictation_moderation_events_video_id", "dictation_moderation_events", ["video_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_dictation_moderation_events_video_id", "dictation_moderation_events")
    op.drop_table("dictation_moderation_events")
