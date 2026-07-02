"""add reject_reason to requests (서비스 센터 반려 사유)

서비스 센터(R17)가 v1.0 범위로 승격되며 상태에 rejected(반려)가 추가되었다.
반려 시 사유를 별도 컬럼(reject_reason)에 저장한다(operator_response와 분리).

Revision ID: b8e4d6f02a13
Revises: a7e3c5d1f482
Create Date: 2026-06-24
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "b8e4d6f02a13"
down_revision = "a7e3c5d1f482"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column(
        "requests",
        sa.Column("reject_reason", sa.Text(), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("requests", "reject_reason", schema=SCHEMA)
