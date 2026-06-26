"""add sort_order to reports (폴더 내 레포트 정렬)

Revision ID: f6d2a3b8c910
Revises: e5c1f9a2b740
Create Date: 2026-06-26
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "f6d2a3b8c910"
down_revision = "e5c1f9a2b740"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column(
        "reports",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("reports", "sort_order", schema=SCHEMA)
