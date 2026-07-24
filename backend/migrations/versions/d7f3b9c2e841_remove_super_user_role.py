"""remove Super_User role (권한 관리 개편: 역할을 General_User/System_Operator 2종으로 축소)

Super_User가 부여하던 유일한 자동 특전(통계 메뉴 노출)은 이제 그룹/사용자 단위
menu_permissions로 대체한다. 레포트별 권한(VIEW_STATS 등)은 역할과 무관하게
report_permissions에 남아있으므로 그대로 유지된다.

테스트 기간 데이터이므로 기존 Super_User 보유자는 별도 이관 없이 정리한다
(운영 배포 시 실사용자가 있다면 이 마이그레이션 적용 전에 대상자를 파악해야 한다).

Revision ID: d7f3b9c2e841
Revises: c5e8a2f7b931
Create Date: 2026-07-14
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "d7f3b9c2e841"
down_revision = "c5e8a2f7b931"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    conn = op.get_bind()
    role_id = conn.execute(
        sa.text(f"SELECT id FROM {SCHEMA}.roles WHERE code = 'Super_User'")
    ).scalar()
    if role_id is not None:
        conn.execute(
            sa.text(f"DELETE FROM {SCHEMA}.user_roles WHERE role_id = :rid"),
            {"rid": role_id},
        )
        conn.execute(
            sa.text(f"DELETE FROM {SCHEMA}.roles WHERE id = :rid"),
            {"rid": role_id},
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            f"INSERT INTO {SCHEMA}.roles (code, name) VALUES ('Super_User', '수퍼 사용자') "
            f"ON CONFLICT (code) DO NOTHING"
        )
    )
