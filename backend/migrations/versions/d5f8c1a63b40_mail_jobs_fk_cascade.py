"""mail_jobs.mail_schedule_id FK → ON DELETE CASCADE

메일 스케줄 삭제 시 발송 이력(mail_jobs)이 있으면 FK 위반(500)이 나던 문제 수정.
mail_jobs→export_jobs, report_image_paths 는 이미 CASCADE 이므로 스케줄 삭제가
발송 이력까지 정리한다(감사 기록은 audit_logs 에 별도 보존).

Revision ID: d5f8c1a63b40
Revises: c4e7a2b9f130
Create Date: 2026-07-06
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "d5f8c1a63b40"
down_revision = "c4e7a2b9f130"
branch_labels = None
depends_on = None

SCHEMA = "bip"
FK_NAME = "mail_jobs_mail_schedule_id_fkey"


def upgrade() -> None:
    op.drop_constraint(FK_NAME, "mail_jobs", schema=SCHEMA, type_="foreignkey")
    op.create_foreign_key(
        FK_NAME,
        "mail_jobs",
        "mail_schedules",
        ["mail_schedule_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint(FK_NAME, "mail_jobs", schema=SCHEMA, type_="foreignkey")
    op.create_foreign_key(
        FK_NAME,
        "mail_jobs",
        "mail_schedules",
        ["mail_schedule_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
    )
