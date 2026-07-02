"""create request_attachments (서비스 센터 첨부 파일)

서비스 센터(R17) 요청에 에러 캡처 이미지/문서 등을 첨부할 수 있도록
request_attachments 테이블을 추가한다. 파일 본체는 StorageService에 저장하고
DB에는 상대 경로/메타만 보관한다(R31.2). 요청 삭제 시 첨부도 CASCADE.

Revision ID: c9f5a1b3d702
Revises: b8e4d6f02a13
Create Date: 2026-06-24
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "c9f5a1b3d702"
down_revision = "b8e4d6f02a13"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.create_table(
        "request_attachments",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("request_id", sa.BigInteger(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.String(length=1024), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("uploaded_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["request_id"], [f"{SCHEMA}.requests.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        schema=SCHEMA,
    )
    op.create_index(
        "idx_request_attachments_request",
        "request_attachments",
        ["request_id"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("idx_request_attachments_request", table_name="request_attachments", schema=SCHEMA)
    op.drop_table("request_attachments", schema=SCHEMA)
