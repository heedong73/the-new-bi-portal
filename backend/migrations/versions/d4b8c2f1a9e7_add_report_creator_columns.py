"""add creator columns to reports + backfill is_published

레포트 관리 화면에 생성자/등록일 표시를 위해 reports에 created_by_user_id /
created_by_label 컬럼을 추가한다. created_at은 기존 컬럼을 그대로 사용한다.

가시성 모델이 "권한(VIEW) 기반"으로 전환되어 is_published는 더 이상 노출을
게이트하지 않으므로(통계 "미사용 리포트" 용도로만 사용), 기존 레포트의
is_published를 true로 정렬한다(가시성과 무관, 통계 일관성 목적).

created_by_user_id는 로컬 관리자(users 테이블에 없는 비상 계정)도 생성자가 될 수
있으므로 FK 제약을 두지 않는다(단순 식별자). 표시는 created_by_label을 사용한다.

Revision ID: d4b8c2f1a9e7
Revises: c3a9f1e7b210
Create Date: 2026-06-25
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "d4b8c2f1a9e7"
down_revision = "c3a9f1e7b210"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column("reports", sa.Column("created_by_user_id", sa.BigInteger(), nullable=True), schema=SCHEMA)
    op.add_column("reports", sa.Column("created_by_label", sa.String(length=255), nullable=True), schema=SCHEMA)
    # 가시성은 권한 기반으로 전환 → 통계 일관성을 위해 기존 레포트를 게시 상태로 정렬
    op.execute(f"UPDATE {SCHEMA}.reports SET is_published = true WHERE is_published = false")


def downgrade() -> None:
    op.drop_column("reports", "created_by_label", schema=SCHEMA)
    op.drop_column("reports", "created_by_user_id", schema=SCHEMA)
