"""add role_menu_permissions + seed defaults

역할별 메뉴(페이지) 접근 권한 매트릭스 저장 테이블. 기본 권한을 시드한다:
- General_User: home
- Super_User: home, stats
- System_Operator: 전체 (코드에서도 항상 전체로 강제하지만 일관성 위해 시드)

Revision ID: e5c1f9a2b740
Revises: d4b8c2f1a9e7
Create Date: 2026-06-26
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "e5c1f9a2b740"
down_revision = "d4b8c2f1a9e7"
branch_labels = None
depends_on = None

SCHEMA = "bip"

ALL_MENUS = [
    "home", "stats", "mail_schedules", "mail_jobs",
    "monitoring_refresh", "monitoring_ops",
    "admin_reports", "admin_users", "admin_groups", "admin_roles", "admin_holidays",
]
DEFAULTS = {
    "General_User": ["home"],
    "Super_User": ["home", "stats"],
    "System_Operator": list(ALL_MENUS),
}


def upgrade() -> None:
    op.create_table(
        "role_menu_permissions",
        sa.Column("role_id", sa.BigInteger(), nullable=False),
        sa.Column("menu_key", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], [f"{SCHEMA}.roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("role_id", "menu_key"),
        schema=SCHEMA,
    )
    # 기본 권한 시드 (역할 code 기준)
    conn = op.get_bind()
    for code, menus in DEFAULTS.items():
        role_id = conn.execute(
            sa.text(f"SELECT id FROM {SCHEMA}.roles WHERE code = :c"), {"c": code}
        ).scalar()
        if role_id is None:
            continue
        for m in menus:
            conn.execute(
                sa.text(
                    f"INSERT INTO {SCHEMA}.role_menu_permissions (role_id, menu_key) "
                    f"VALUES (:r, :m) ON CONFLICT DO NOTHING"
                ),
                {"r": role_id, "m": m},
            )


def downgrade() -> None:
    op.drop_table("role_menu_permissions", schema=SCHEMA)
