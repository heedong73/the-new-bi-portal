"""mail_schedules: 사용자 친화 스케줄(주기/시간/기간) 컬럼 추가

Cron식 직접 입력 대신 주기(daily/weekly/monthly) + 시간 + (주: 요일들 / 월: 일자)
+ 발송 기간(start_date/end_date)을 입력받는다. cron_expr 는 서버가 이로부터
생성해 계속 저장하며, 발화 판정(croniter)은 그대로 사용한다.

Revision ID: e2c8f4a9d610
Revises: d1a7b4e9c530
Create Date: 2026-06-24
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "e2c8f4a9d610"
down_revision = "d1a7b4e9c530"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column("mail_schedules", sa.Column("schedule_freq", sa.String(length=16), nullable=True), schema=SCHEMA)
    op.add_column("mail_schedules", sa.Column("schedule_time", sa.String(length=8), nullable=True), schema=SCHEMA)
    op.add_column("mail_schedules", sa.Column("schedule_days", sa.String(length=32), nullable=True), schema=SCHEMA)
    op.add_column("mail_schedules", sa.Column("schedule_day_of_month", sa.Integer(), nullable=True), schema=SCHEMA)
    op.add_column("mail_schedules", sa.Column("start_date", sa.Date(), nullable=True), schema=SCHEMA)
    op.add_column("mail_schedules", sa.Column("end_date", sa.Date(), nullable=True), schema=SCHEMA)


def downgrade() -> None:
    op.drop_column("mail_schedules", "end_date", schema=SCHEMA)
    op.drop_column("mail_schedules", "start_date", schema=SCHEMA)
    op.drop_column("mail_schedules", "schedule_day_of_month", schema=SCHEMA)
    op.drop_column("mail_schedules", "schedule_days", schema=SCHEMA)
    op.drop_column("mail_schedules", "schedule_time", schema=SCHEMA)
    op.drop_column("mail_schedules", "schedule_freq", schema=SCHEMA)
