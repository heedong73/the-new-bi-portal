"""add reports.author_label + report_favorites

- reports.author_label: 실제 작성자(현업) 표시명. 업로더(created_by_label)와 별개.
  인사 검색으로 고른 '이름(사번)' 또는 자유 텍스트(퇴직자 등).
- report_favorites: 사용자별 즐겨찾기 (user_id, report_id).

Revision ID: a7e3c5d1f482
Revises: f6d2a3b8c910
Create Date: 2026-06-26
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "a7e3c5d1f482"
down_revision = "f6d2a3b8c910"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column("reports", sa.Column("author_label", sa.String(length=255), nullable=True), schema=SCHEMA)
    op.create_table(
        "report_favorites",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("report_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["report_id"], [f"{SCHEMA}.reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "report_id"),
        schema=SCHEMA,
    )
    op.create_index("idx_report_favorites_user", "report_favorites", ["user_id"], schema=SCHEMA)


def downgrade() -> None:
    op.drop_index("idx_report_favorites_user", table_name="report_favorites", schema=SCHEMA)
    op.drop_table("report_favorites", schema=SCHEMA)
    op.drop_column("reports", "author_label", schema=SCHEMA)
