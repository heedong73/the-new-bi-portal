"""reports.default_view_state (공통 기본 뷰 상태 — Power BI 북마크 state)

관리자가 저장한 슬라이서/필터/페이지 선택(Power BI 북마크 state 문자열)을 담는
nullable TEXT 컬럼. 값이 있으면 해당 레포트를 여는 모든 뷰어가 이 상태로 시작한다
(.pbix 수정/재업로드 없이 기본 뷰만 변경).

Revision ID: a7c3e9f14d80
Revises: c1a8e5b2f930
Create Date: 2026-07-02
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "a7c3e9f14d80"
down_revision = "c1a8e5b2f930"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column(
        "reports",
        sa.Column("default_view_state", sa.Text(), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("reports", "default_view_state", schema=SCHEMA)
