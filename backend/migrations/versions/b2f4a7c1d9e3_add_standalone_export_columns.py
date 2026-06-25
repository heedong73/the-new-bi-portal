"""add standalone export columns to export_jobs (T-25 drift fix)

T-25에서 ExportJob 모델에 추가된 독립 Export 컬럼들이 마이그레이션에 누락되어
있었다. T-28 메일 파이프라인이 이 컬럼들을 사용하므로 보강한다.

Revision ID: b2f4a7c1d9e3
Revises: 6c7e9e71b76b
Create Date: 2026-06-24
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "b2f4a7c1d9e3"
down_revision = "6c7e9e71b76b"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column("export_jobs", sa.Column("requested_by_user_id", sa.BigInteger(), nullable=True), schema=SCHEMA)
    op.add_column("export_jobs", sa.Column("report_id", sa.BigInteger(), nullable=True), schema=SCHEMA)
    op.add_column("export_jobs", sa.Column("workspace_id", sa.String(length=128), nullable=True), schema=SCHEMA)
    op.add_column("export_jobs", sa.Column("export_format", sa.String(length=16), nullable=True), schema=SCHEMA)
    op.add_column("export_jobs", sa.Column("file_path", sa.String(length=1024), nullable=True), schema=SCHEMA)
    op.add_column("export_jobs", sa.Column("file_name", sa.String(length=255), nullable=True), schema=SCHEMA)
    op.add_column("export_jobs", sa.Column("mime_type", sa.String(length=128), nullable=True), schema=SCHEMA)
    op.add_column("export_jobs", sa.Column("error_message", sa.Text(), nullable=True), schema=SCHEMA)
    op.create_foreign_key(
        "fk_export_jobs_report_id", "export_jobs", "reports",
        ["report_id"], ["id"], source_schema=SCHEMA, referent_schema=SCHEMA,
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_export_jobs_report_id", "export_jobs", schema=SCHEMA, type_="foreignkey")
    for col in (
        "error_message", "mime_type", "file_name", "file_path",
        "export_format", "workspace_id", "report_id", "requested_by_user_id",
    ):
        op.drop_column("export_jobs", col, schema=SCHEMA)
