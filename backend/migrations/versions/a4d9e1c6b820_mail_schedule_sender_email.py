"""메일 스케줄: sender_email (보내는 사람 주소, 스케줄별 설정)

비우면 서버 기본값(settings.SMTP_FROM)을 사용한다.

Revision ID: a4d9e1c6b820
Revises: f3b1c8d47a20
Create Date: 2026-07-02
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "a4d9e1c6b820"
down_revision = "f3b1c8d47a20"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column(
        "mail_schedules",
        sa.Column("sender_email", sa.String(length=255), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("mail_schedules", "sender_email", schema=SCHEMA)
