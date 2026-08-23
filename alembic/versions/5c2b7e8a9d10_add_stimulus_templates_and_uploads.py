"""add stimulus templates and uploads

Revision ID: 5c2b7e8a9d10
Revises: f43a6d91c2b7
Create Date: 2026-08-23 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5c2b7e8a9d10"
down_revision: str | Sequence[str] | None = "f43a6d91c2b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    is_postgresql = bind.dialect.name == "postgresql"
    json_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgresql else sa.JSON()

    op.add_column("stimulus", sa.Column("render_kind", sa.String(length=40), nullable=False, server_default="text"))
    op.add_column("stimulus", sa.Column("content", json_type, nullable=True))
    op.add_column("stimulus", sa.Column("image_path", sa.String(length=500), nullable=True))
    op.add_column("stimulus", sa.Column("transcript", sa.Text(), nullable=True))
    op.add_column("stimulus", sa.Column("status", sa.String(length=20), nullable=False, server_default="published"))
    op.create_check_constraint(
        "ck_stimulus_image_path_only_for_image",
        "stimulus",
        "render_kind = 'image' or image_path is null",
    )
    op.create_check_constraint(
        "ck_stimulus_image_has_transcript",
        "stimulus",
        "render_kind <> 'image' or transcript is not null",
    )
    op.create_check_constraint(
        "ck_stimulus_status",
        "stimulus",
        "status in ('draft', 'published')",
    )

    op.create_table(
        "upload",
        sa.Column("path", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("stimulus_id", sa.String(length=36), nullable=True),
        sa.Column("delete_after_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["stimulus_id"], ["stimulus.id"]),
        sa.PrimaryKeyConstraint("path"),
    )
    op.create_index(op.f("ix_upload_stimulus_id"), "upload", ["stimulus_id"], unique=False)

    if is_postgresql:
        op.execute(
            """
            insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
            values (
              'stimuli',
              'stimuli',
              true,
              2097152,
              array['image/jpeg', 'image/png', 'image/webp']
            )
            on conflict (id) do update
            set
              public = excluded.public,
              file_size_limit = excluded.file_size_limit,
              allowed_mime_types = excluded.allowed_mime_types
            """
        )
        op.execute(
            """
            drop policy if exists "Public read stimuli" on storage.objects
            """
        )
        op.execute(
            """
            create policy "Public read stimuli"
            on storage.objects for select
            using (bucket_id = 'stimuli')
            """
        )
        op.execute(
            """
            drop policy if exists "Service role writes stimuli" on storage.objects
            """
        )
        op.execute(
            """
            create policy "Service role writes stimuli"
            on storage.objects for all
            to service_role
            using (bucket_id = 'stimuli')
            with check (bucket_id = 'stimuli')
            """
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute('drop policy if exists "Service role writes stimuli" on storage.objects')
        op.execute('drop policy if exists "Public read stimuli" on storage.objects')
        op.execute("delete from storage.buckets where id = 'stimuli'")

    op.drop_index(op.f("ix_upload_stimulus_id"), table_name="upload")
    op.drop_table("upload")
    op.drop_constraint("ck_stimulus_status", "stimulus", type_="check")
    op.drop_constraint("ck_stimulus_image_has_transcript", "stimulus", type_="check")
    op.drop_constraint("ck_stimulus_image_path_only_for_image", "stimulus", type_="check")
    op.drop_column("stimulus", "status")
    op.drop_column("stimulus", "transcript")
    op.drop_column("stimulus", "image_path")
    op.drop_column("stimulus", "content")
    op.drop_column("stimulus", "render_kind")
