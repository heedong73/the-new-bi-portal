"""add holidays table + mail_schedules skip flags (공휴일/주말 발송 제외)

Revision ID: c3a9f1e7b210
Revises: b2f4a7c1d9e3
Create Date: 2026-06-24
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "c3a9f1e7b210"
down_revision = "b2f4a7c1d9e3"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    # 휴일 달력 테이블
    op.create_table(
        "holidays",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("holiday_date", sa.Date(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("holiday_type", sa.String(length=16), nullable=False, server_default="company"),
        sa.Column("is_recurring", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("holiday_date"),
        schema=SCHEMA,
    )

    # 스케줄별 발송 제외 정책 (기본 true)
    op.add_column(
        "mail_schedules",
        sa.Column("skip_weekends", sa.Boolean(), nullable=False, server_default=sa.true()),
        schema=SCHEMA,
    )
    op.add_column(
        "mail_schedules",
        sa.Column("skip_holidays", sa.Boolean(), nullable=False, server_default=sa.true()),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("mail_schedules", "skip_holidays", schema=SCHEMA)
    op.drop_column("mail_schedules", "skip_weekends", schema=SCHEMA)
    op.drop_table("holidays", schema=SCHEMA)
