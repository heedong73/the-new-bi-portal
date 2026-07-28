"""메일 수신자 순서 컬럼 추가.

수정 화면에서 정한 수신자 순서를 저장하고 실제 메일 헤더에도 동일하게 반영한다.
기존 행은 스케줄별 id 오름차순으로 0부터 순번을 부여해 이전 조회 순서를 유지한다.
롤링 배포 중 구버전 서버의 INSERT도 허용하도록 DB 기본값 0은 유지한다.

Revision ID: f2d6a8c4b917
Revises: e1c7d3a95f24
Create Date: 2026-07-14
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "f2d6a8c4b917"
down_revision = "e1c7d3a95f24"
branch_labels = None
depends_on = None

SCHEMA = "bip"
TABLE = "mail_recipients"


def upgrade() -> None:
    op.add_column(
        TABLE,
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        schema=SCHEMA,
    )
    op.execute(
        sa.text(
            f"""
            WITH ranked AS (
                SELECT
                    id,
                    (ROW_NUMBER() OVER (
                        PARTITION BY mail_schedule_id
                        ORDER BY id
                    ) - 1)::integer AS position
                FROM {SCHEMA}.{TABLE}
            )
            UPDATE {SCHEMA}.{TABLE} AS recipient
            SET sort_order = ranked.position
            FROM ranked
            WHERE recipient.id = ranked.id
            """
        )
    )


def downgrade() -> None:
    op.drop_column(TABLE, "sort_order", schema=SCHEMA)
