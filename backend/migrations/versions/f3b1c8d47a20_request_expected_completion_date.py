"""서비스 센터: requests.expected_completion_date (관리자 완료예정일)

R17 개편으로 관리자가 요청의 완료예정일을 직접 설정한다(우선순위 기반 SLA 대체).

Revision ID: f3b1c8d47a20
Revises: e2c8f4a9d610
Create Date: 2026-07-01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "f3b1c8d47a20"
down_revision = "e2c8f4a9d610"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column(
        "requests",
        sa.Column("expected_completion_date", sa.Date(), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("requests", "expected_completion_date", schema=SCHEMA)
