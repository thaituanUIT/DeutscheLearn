"""replace admin content schema

Revision ID: f43a6d91c2b7
Revises: 8d6e4adf9a21
Create Date: 2026-08-22 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f43a6d91c2b7"
down_revision: str | Sequence[str] | None = "8d6e4adf9a21"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_table("reading_answers")
    op.drop_table("reading_questions")
    op.drop_table("reading_passages")
    op.drop_table("focus_word_entries")
    op.drop_table("cached_words")

    op.create_table(
        "word",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("lemma", sa.String(length=120), nullable=False),
        sa.Column("article", sa.String(length=8), nullable=True),
        sa.Column("part_of_speech", sa.String(length=80), nullable=False),
        sa.Column("meaning", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("article in ('der', 'die', 'das') or article is null", name="ck_word_article"),
        sa.CheckConstraint("article is null or part_of_speech = 'noun'", name="ck_word_article_only_for_noun"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("lemma"),
    )
    op.create_index(op.f("ix_word_lemma"), "word", ["lemma"], unique=False)

    op.create_table(
        "topic",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index(op.f("ix_topic_slug"), "topic", ["slug"], unique=False)

    op.create_table(
        "stimulus",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("collection", sa.String(length=40), nullable=False),
        sa.Column("level", sa.String(length=8), nullable=False),
        sa.Column("teil", sa.String(length=40), nullable=True),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("image_url", sa.String(length=500), nullable=True),
        sa.Column("audio_url", sa.String(length=500), nullable=True),
        sa.Column("context_label", sa.String(length=160), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("collection in ('general', 'goethe')", name="ck_stimulus_collection"),
        sa.CheckConstraint("collection <> 'goethe' or teil is not null", name="ck_goethe_stimulus_has_teil"),
        sa.CheckConstraint("kind in ('text', 'ad', 'sign')", name="ck_stimulus_kind"),
        sa.CheckConstraint("level in ('A1', 'A2', 'B1', 'B2')", name="ck_stimulus_level"),
        sa.CheckConstraint("teil in ('teil_1', 'teil_2', 'teil_3', 'teil_4', 'teil_5') or teil is null", name="ck_stimulus_teil"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_stimulus_collection"), "stimulus", ["collection"], unique=False)
    op.create_index(op.f("ix_stimulus_teil"), "stimulus", ["teil"], unique=False)

    op.create_table(
        "word_focus",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("word_id", sa.String(length=36), nullable=False),
        sa.Column("level", sa.String(length=8), nullable=False),
        sa.Column("topic_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["topic_id"], ["topic.id"]),
        sa.ForeignKeyConstraint(["word_id"], ["word.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("word_id", "level", "topic_id", name="uq_word_focus_word_level_topic"),
    )
    op.create_index(op.f("ix_word_focus_topic_id"), "word_focus", ["topic_id"], unique=False)
    op.create_index(op.f("ix_word_focus_word_id"), "word_focus", ["word_id"], unique=False)

    op.create_table(
        "item",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("stimulus_id", sa.String(length=36), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("answer_type", sa.String(length=40), nullable=False),
        sa.Column("correct_option_id", sa.String(length=36), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.CheckConstraint("answer_type in ('true_false', 'choice')", name="ck_item_answer_type"),
        sa.ForeignKeyConstraint(["stimulus_id"], ["stimulus.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_item_stimulus_id"), "item", ["stimulus_id"], unique=False)

    op.create_table(
        "item_option",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("item_id", sa.String(length=36), nullable=False),
        sa.Column("key", sa.String(length=20), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("ref_stimulus_id", sa.String(length=36), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["item_id"], ["item.id"]),
        sa.ForeignKeyConstraint(["ref_stimulus_id"], ["stimulus.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_item_option_item_id"), "item_option", ["item_id"], unique=False)
    op.create_index(op.f("ix_item_option_ref_stimulus_id"), "item_option", ["ref_stimulus_id"], unique=False)
    op.create_foreign_key(
        "fk_item_correct_option_id_item_option",
        "item",
        "item_option",
        ["correct_option_id"],
        ["id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("fk_item_correct_option_id_item_option", "item", type_="foreignkey")
    op.drop_table("item_option")
    op.drop_table("item")
    op.drop_table("word_focus")
    op.drop_table("stimulus")
    op.drop_table("topic")
    op.drop_index(op.f("ix_word_lemma"), table_name="word")
    op.drop_table("word")
