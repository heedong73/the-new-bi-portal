"""서비스 센터 고도화: requests.priority + request_comments

R17 고도화로 요청에 우선순위(SLA 산정 기준)와 댓글 스레드를 추가한다.
- requests.priority: low/normal/high/urgent (기본 normal)
- request_comments: 요청자/운영자 메시지 스레드(요청 삭제 시 CASCADE)

Revision ID: d1a7b4e9c530
Revises: c9f5a1b3d702
Create Date: 2026-06-24
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "d1a7b4e9c530"
down_revision = "c9f5a1b3d702"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column(
        "requests",
        sa.Column("priority", sa.String(length=16), server_default="normal", nullable=False),
        schema=SCHEMA,
    )
    op.create_table(
        "request_comments",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("request_id", sa.BigInteger(), nullable=False),
        sa.Column("author_user_id", sa.BigInteger(), nullable=True),
        sa.Column("author_label", sa.String(length=255), nullable=True),
        sa.Column("is_operator", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["request_id"], [f"{SCHEMA}.requests.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        schema=SCHEMA,
    )
    op.create_index(
        "idx_request_comments_request",
        "request_comments",
        ["request_id"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("idx_request_comments_request", table_name="request_comments", schema=SCHEMA)
    op.drop_table("request_comments", schema=SCHEMA)
    op.drop_column("requests", "priority", schema=SCHEMA)
