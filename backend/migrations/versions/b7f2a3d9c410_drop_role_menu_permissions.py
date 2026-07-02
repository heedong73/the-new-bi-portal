"""role_menu_permissions 테이블 제거 (역할→메뉴 코드 고정 매핑으로 전환)

역할별 메뉴 권한을 편집하는 매트릭스를 없애고, 역할 → 메뉴 접근을 코드
(constants.ROLE_MENUS)로 고정한다. 더 이상 사용하지 않는 테이블을 제거한다.

Revision ID: b7f2a3d9c410
Revises: a4d9e1c6b820
Create Date: 2026-07-03
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "b7f2a3d9c410"
down_revision = "a4d9e1c6b820"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.drop_table("role_menu_permissions", schema=SCHEMA)


def downgrade() -> None:
    op.create_table(
        "role_menu_permissions",
        sa.Column("role_id", sa.BigInteger(), nullable=False),
        sa.Column("menu_key", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], [f"{SCHEMA}.roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("role_id", "menu_key"),
        schema=SCHEMA,
    )
