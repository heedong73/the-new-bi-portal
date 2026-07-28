"""사용자별 즐겨찾기 폴더와 즐겨찾기-폴더 연결 추가.

기존 report_favorites 행의 favorite_folder_id는 NULL로 유지되어 모두 '미분류'로
무손실 이관된다. 폴더 삭제 시에도 즐겨찾기는 삭제하지 않고 FK SET NULL로 미분류에
남긴다.

Revision ID: c8f2d4a71b60
Revises: a2d7f4b81c65
Create Date: 2026-07-14
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "c8f2d4a71b60"
down_revision = "a2d7f4b81c65"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.create_table(
        "favorite_folders",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("normalized_name", sa.String(length=80), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "id", name="uq_favorite_folders_user_id_id"
        ),
        sa.UniqueConstraint(
            "user_id", "normalized_name", name="uq_favorite_folders_user_name"
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_favorite_folders_user_sort",
        "favorite_folders",
        ["user_id", "sort_order", "id"],
        schema=SCHEMA,
    )
    op.add_column(
        "report_favorites",
        sa.Column("favorite_folder_id", sa.BigInteger(), nullable=True),
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "fk_report_favorites_favorite_folder_id",
        "report_favorites",
        "favorite_folders",
        ["favorite_folder_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_report_favorites_owned_folder",
        "report_favorites",
        "favorite_folders",
        ["user_id", "favorite_folder_id"],
        ["user_id", "id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
    )
    op.create_index(
        "ix_report_favorites_user_folder",
        "report_favorites",
        ["user_id", "favorite_folder_id"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_report_favorites_user_folder",
        table_name="report_favorites",
        schema=SCHEMA,
    )
    op.drop_constraint(
        "fk_report_favorites_owned_folder",
        "report_favorites",
        schema=SCHEMA,
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_report_favorites_favorite_folder_id",
        "report_favorites",
        schema=SCHEMA,
        type_="foreignkey",
    )
    op.drop_column("report_favorites", "favorite_folder_id", schema=SCHEMA)
    op.drop_index(
        "ix_favorite_folders_user_sort",
        table_name="favorite_folders",
        schema=SCHEMA,
    )
    op.drop_table("favorite_folders", schema=SCHEMA)
