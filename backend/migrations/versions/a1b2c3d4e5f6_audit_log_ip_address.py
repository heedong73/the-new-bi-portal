"""add audit_logs.ip_address

- 감사 로그 조회 화면에서 "어떤 IP에서 접근했는지"를 보여주기 위해 추가한다.
- nginx(리버스 프록시)가 X-Forwarded-For/X-Real-IP를 백엔드로 전달하므로
  app.core.http_utils.client_ip()가 해석한 값을 append_audit()이 자동으로
  채운다(요청 스코프 contextvar 경유, 호출부 개별 수정 없음).
- 참고용 필드이므로 위조 가능성을 감안해 nullable로 둔다.

Revision ID: a1b2c3d4e5f6
Revises: f9a4c2d7e610
Create Date: 2026-07-14
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "f9a4c2d7e610"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column(
        "audit_logs",
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("audit_logs", "ip_address", schema=SCHEMA)
