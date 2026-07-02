"""user_groups.source_dept_id (조직도 자동 생성 팀 그룹 식별/재동기화)

값이 있으면 "자동 관리 팀 그룹"으로, 조직도 기반 완전 동기화(추가+제거) 대상이 된다.
수동 생성 그룹은 NULL로 남아 동기화가 건드리지 않는다.

Revision ID: c1a8e5b2f930
Revises: b7f2a3d9c410
Create Date: 2026-07-04
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "c1a8e5b2f930"
down_revision = "b7f2a3d9c410"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column(
        "user_groups",
        sa.Column("source_dept_id", sa.String(length=128), nullable=True),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_bip_user_groups_source_dept_id",
        "user_groups",
        ["source_dept_id"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("ix_bip_user_groups_source_dept_id", table_name="user_groups", schema=SCHEMA)
    op.drop_column("user_groups", "source_dept_id", schema=SCHEMA)
