"""add users.last_login_at and local_admins.last_login_at

- 우측 상단 사용자 정보에 "마지막 접속일시"를 표시하기 위해 추가한다.
- 로그인 성공 시점(api/routes/auth.py)에서 갱신하며, 응답에는 UTC로 내려주고
  프런트가 표시용 로컬 문자열로 포맷한다.

Revision ID: b3c4d5e6f708
Revises: a1b2c3d4e5f6
Create Date: 2026-07-14
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "b3c4d5e6f708"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "local_admins",
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("local_admins", "last_login_at", schema=SCHEMA)
    op.drop_column("users", "last_login_at", schema=SCHEMA)
