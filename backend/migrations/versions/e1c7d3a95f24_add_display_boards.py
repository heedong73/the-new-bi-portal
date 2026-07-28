"""KPI 전광판(플레이리스트)과 순환 슬라이드 테이블 추가.

전광판은 여러 레포트/페이지를 순서대로 묶어 전체화면에서 자동 순환 표시하는 구성이다.
- display_boards: 전광판 본체(이름/설명/활성 여부/기본 노출 시간).
- display_board_slides: 순환 단위(레포트 + 선택 페이지 + 개별 노출 시간 + 순서).

기존 데이터는 건드리지 않는 순수 추가 마이그레이션이다. 레포트가 삭제되면 해당
슬라이드도 함께 삭제되어(ON DELETE CASCADE) 재생 중 깨진 슬라이드가 남지 않는다.

Revision ID: e1c7d3a95f24
Revises: c8f2d4a71b60
Create Date: 2026-07-27
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "e1c7d3a95f24"
down_revision = "c8f2d4a71b60"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.create_table(
        "display_boards",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("normalized_name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=300), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "default_dwell_seconds", sa.Integer(), server_default="30", nullable=False
        ),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_by_label", sa.String(length=255), nullable=True),
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
        sa.UniqueConstraint("normalized_name", name="uq_display_boards_normalized_name"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_display_boards_active_name",
        "display_boards",
        ["is_active", "name"],
        schema=SCHEMA,
    )

    op.create_table(
        "display_board_slides",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("board_id", sa.BigInteger(), nullable=False),
        sa.Column("report_id", sa.BigInteger(), nullable=False),
        sa.Column("page_name", sa.String(length=255), nullable=True),
        sa.Column("page_display_name", sa.String(length=255), nullable=True),
        sa.Column("dwell_seconds", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["board_id"],
            [f"{SCHEMA}.display_boards.id"],
            name="fk_display_board_slides_board_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["report_id"],
            [f"{SCHEMA}.reports.id"],
            name="fk_display_board_slides_report_id",
            ondelete="CASCADE",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_display_board_slides_board_order",
        "display_board_slides",
        ["board_id", "sort_order", "id"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_display_board_slides_board_order",
        table_name="display_board_slides",
        schema=SCHEMA,
    )
    op.drop_table("display_board_slides", schema=SCHEMA)
    op.drop_index(
        "ix_display_boards_active_name",
        table_name="display_boards",
        schema=SCHEMA,
    )
    op.drop_table("display_boards", schema=SCHEMA)
