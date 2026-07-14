"""add audit_logs.duration_seconds

- report_view 로그는 Embed Token 발급(진입) 시점에 1건만 기록되어 "언제 열었는지"만
  알 수 있었다. 체류 시간(대략치) 추적을 위해 duration_seconds 컬럼을 추가하고,
  프런트가 탭 전환/이탈 시점에 그 로그를 찾아 경과 시간을 갱신한다(신규 로그 생성 없음).
- 로우데이터 export(통계 화면) 정렬/집계 편의를 위해 meta(JSONB) 대신 컬럼으로 둔다.

Revision ID: d8a3f7c1e920
Revises: e2c9b7a4d150
Create Date: 2026-07-13
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "d8a3f7c1e920"
down_revision = "e2c9b7a4d150"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column(
        "audit_logs",
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("audit_logs", "duration_seconds", schema=SCHEMA)
