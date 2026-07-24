"""create menu_permissions and group_company_scopes tables

권한 관리 개편(그룹 중심 메뉴/레포트 권한 관리):
- menu_permissions: 사용자/그룹 주체로 메뉴(페이지) 접근을 추가 부여.
- group_company_scopes: 그룹에 계열사(최상위 report_folders)를 지정하면
  그 하위 전체 레포트에 VIEW를 자동 부여(레포트별 개별 부여 부담을 완화).

Revision ID: c5e8a2f7b931
Revises: b3c4d5e6f708
Create Date: 2026-07-14
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "c5e8a2f7b931"
down_revision = "b3c4d5e6f708"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.create_table(
        "menu_permissions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("subject_type", sa.String(length=16), nullable=False),
        sa.Column("subject_id", sa.BigInteger(), nullable=False),
        sa.Column("menu_key", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("subject_type", "subject_id", "menu_key"),
        schema=SCHEMA,
    )
    op.create_table(
        "group_company_scopes",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("group_id", sa.BigInteger(), nullable=False),
        sa.Column("root_folder_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], [f"{SCHEMA}.user_groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["root_folder_id"], [f"{SCHEMA}.report_folders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("group_id", "root_folder_id"),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("group_company_scopes", schema=SCHEMA)
    op.drop_table("menu_permissions", schema=SCHEMA)
