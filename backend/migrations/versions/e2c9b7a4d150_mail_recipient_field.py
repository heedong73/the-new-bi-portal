"""mail_recipients.field 추가 (받는사람/참조/숨은참조: to/cc/bcc)

메일 스케줄 수신자를 받는사람(to)/참조(cc)/숨은참조(bcc)로 구분하기 위한 컬럼.
기존 행은 server_default 'to'로 채워져 기존 발송 동작(전원 To)이 유지된다.

Revision ID: e2c9b7a4d150
Revises: d5f8c1a63b40
Create Date: 2026-07-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e2c9b7a4d150"
down_revision = "d5f8c1a63b40"
branch_labels = None
depends_on = None

SCHEMA = "bip"
TABLE = "mail_recipients"
CK_NAME = "ck_mail_recipient_field"


def upgrade() -> None:
    op.add_column(
        TABLE,
        sa.Column("field", sa.String(length=8), server_default="to", nullable=False),
        schema=SCHEMA,
    )
    op.create_check_constraint(
        CK_NAME,
        TABLE,
        "field IN ('to', 'cc', 'bcc')",
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint(CK_NAME, TABLE, schema=SCHEMA, type_="check")
    op.drop_column(TABLE, "field", schema=SCHEMA)
