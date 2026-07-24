"""bip.users에 로컬 계정 컬럼 추가 (password_hash, is_local).

그룹웨어(HR) 사용자와 별도로 관리자가 직접 만드는 로컬 계정을 지원한다.
- password_hash: argon2id 해시. HR 매핑 사용자는 NULL로 둔다.
- is_local: True면 로컬 계정(HR 인사 정보 없음, department_id NULL 유지).

Revision ID: e8b9d1a4c520
Revises: d7f3b9c2e841
Create Date: 2026-07-14
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "e8b9d1a4c520"
down_revision = "d7f3b9c2e841"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("password_hash", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "users",
        sa.Column("is_local", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema=SCHEMA,
    )
    # server_default는 기존 행 채우기용. 이후 애플리케이션이 명시적으로 값을 설정한다.
    op.alter_column("users", "is_local", server_default=None, schema=SCHEMA)


def downgrade() -> None:
    op.drop_column("users", "is_local", schema=SCHEMA)
    op.drop_column("users", "password_hash", schema=SCHEMA)
