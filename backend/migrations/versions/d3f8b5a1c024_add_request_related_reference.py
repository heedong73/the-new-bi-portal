"""Add optional self-reference so a follow-up request can cite a previous one.

완료된 요청은 대화가 닫히므로, 후속 문의는 새 요청에서 이전 요청을 참고로
가리킨다. 참조 대상이 삭제되면 후속 요청은 남기고 참조만 NULL로 만든다.

Revision ID: d3f8b5a1c024
Revises: c6d9a2e4f781
Create Date: 2026-07-31
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "d3f8b5a1c024"
down_revision = "c6d9a2e4f781"
branch_labels = None
depends_on = None

SCHEMA = "bip"
FK_NAME = "fk_requests_related_request"
INDEX_NAME = "idx_requests_related"


def upgrade() -> None:
    op.add_column(
        "requests",
        sa.Column("related_request_id", sa.BigInteger(), nullable=True),
        schema=SCHEMA,
    )
    op.create_foreign_key(
        FK_NAME,
        "requests",
        "requests",
        ["related_request_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="SET NULL",
    )
    op.create_index(INDEX_NAME, "requests", ["related_request_id"], schema=SCHEMA)


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name="requests", schema=SCHEMA)
    op.drop_constraint(FK_NAME, "requests", schema=SCHEMA, type_="foreignkey")
    op.drop_column("requests", "related_request_id", schema=SCHEMA)
