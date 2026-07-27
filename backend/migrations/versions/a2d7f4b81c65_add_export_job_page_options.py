"""export_jobs에 페이지 단위 내보내기 옵션 컬럼 추가.

레포트 뷰의 다운로드가 "현재 보고 있는 페이지 1장"을 기본으로 하고, 요청자 화면의
슬라이서/필터 선택을 결과에 반영하기 위해 필요한 값들을 잡 행에 보관한다.
(export_poll 워커는 job id만 받아 DB에서 다시 읽는 구조이므로, Celery 인자로만
넘기면 재시도 시 옵션이 사라진다.)

- page_display_name: 파일명 표기용 사람이 읽는 페이지 이름
  (기존 page_name은 Power BI 내부 섹션 id라 파일명에 부적합).
- bookmark_state: 클라이언트가 캡처한 Power BI 북마크 state 문자열.
  ExportTo 호출 시 단일 페이지는 pages[].bookmark, 전체는 defaultBookmark로 전달한다.
- page_names_csv: 전체 페이지 내보내기 시 내보낼 페이지 순서(숨김 페이지 제외).

Revision ID: a2d7f4b81c65
Revises: f4a1c6d92b73
Create Date: 2026-07-14
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "a2d7f4b81c65"
down_revision = "f4a1c6d92b73"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column(
        "export_jobs",
        sa.Column("page_display_name", sa.String(length=255), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "export_jobs",
        sa.Column("bookmark_state", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "export_jobs",
        sa.Column("page_names_csv", sa.Text(), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("export_jobs", "page_names_csv", schema=SCHEMA)
    op.drop_column("export_jobs", "bookmark_state", schema=SCHEMA)
    op.drop_column("export_jobs", "page_display_name", schema=SCHEMA)
