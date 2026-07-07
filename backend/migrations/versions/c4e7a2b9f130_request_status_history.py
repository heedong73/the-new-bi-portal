"""서비스 센터: request_status_history (상태 변경 이력 from→to)

요청 상태가 바뀔 때마다(생성 포함) from_status→to_status 를 기록해 상세 화면에
타임라인으로 노출한다. 요청 삭제 시 CASCADE.

Revision ID: c4e7a2b9f130
Revises: a7c3e9f14d80
Create Date: 2026-07-06
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "c4e7a2b9f130"
down_revision = "a7c3e9f14d80"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.create_table(
        "request_status_history",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("request_id", sa.BigInteger(), nullable=False),
        sa.Column("from_status", sa.String(length=16), nullable=True),
        sa.Column("to_status", sa.String(length=16), nullable=False),
        sa.Column("changed_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("changed_by_label", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["request_id"], [f"{SCHEMA}.requests.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        schema=SCHEMA,
    )
    op.create_index(
        "idx_request_status_history_request",
        "request_status_history",
        ["request_id"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_request_status_history_request",
        table_name="request_status_history",
        schema=SCHEMA,
    )
    op.drop_table("request_status_history", schema=SCHEMA)
