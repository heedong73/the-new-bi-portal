"""권한 체계 정리: 부여 가능 메뉴를 통계로 제한 + 레포트 권한 분리 backfill.

스키마 변경은 없다(데이터 정리·보정 전용).
report_permissions.permission은 VARCHAR(32)이고 CHECK 제약이 없어 새 권한 코드
(DOWNLOAD_PBIX, MANAGE_DEFAULT_VIEW)는 컬럼 변경 없이 저장된다.

1) menu_permissions: 통계(stats) 외 개별 부여 행을 제거한다.
   관리자/운영 메뉴(관리자 계열, 운영 상태, Refresh 현황, 메일 이력/스케줄)는
   System_Operator 전용 정책으로 확정되어 개별 부여 대상이 아니다. 애플리케이션도
   이 행을 무시하지만(deps._granted_menu_keys 필터), 원장을 정책과 일치시킨다.

2) MANAGE_REPORT 보유 주체에 MANAGE_DEFAULT_VIEW를 부여한다(동작 보존).
   기존에는 '교체' 권한 하나가 PBIX 교체와 공통 기본 뷰 저장을 함께 허용했다.
   두 권한으로 분리되므로, 기존 부여자가 기본 뷰 저장을 계속 쓸 수 있게 보정한다.

3) 조회를 전제로 하는 권한 보유 주체에 VIEW를 부여한다(모순 해소).
   다운로드/새로고침/교체/기본 뷰 관리만 있고 VIEW가 없으면 목록에 보이지 않는데도
   해당 액션은 통과하는 모순 상태였다. 이미 그 레포트에 액션 권한이 있던 주체이므로
   실질적 권한 확대가 아니라 일관성 보정이다.

주의: DOWNLOAD(내보내기) 보유자에게 DOWNLOAD_PBIX(원본 .pbix)는 자동 부여하지 않는다.
원본 파일은 데이터 모델을 포함해 위험도가 달라 분리한 것이므로, 필요한 대상에만
관리자가 권한 관리 화면에서 명시적으로 부여한다.

Revision ID: f4a1c6d92b73
Revises: e8b9d1a4c520
Create Date: 2026-07-14
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "f4a1c6d92b73"
down_revision = "e8b9d1a4c520"
branch_labels = None
depends_on = None

# 조회(VIEW)를 전제로 하는 액션 — app.core.constants.ACTIONS_IMPLYING_VIEW와 일치.
_ACTIONS_IMPLYING_VIEW = (
    "DOWNLOAD",
    "DOWNLOAD_PBIX",
    "REFRESH",
    "MANAGE_REPORT",
    "MANAGE_DEFAULT_VIEW",
)


def upgrade() -> None:
    conn = op.get_bind()

    # 1) 통계 외 개별 메뉴 권한 제거
    conn.execute(sa.text(
        "DELETE FROM bip.menu_permissions WHERE menu_key <> 'stats'"
    ))

    # 2) MANAGE_REPORT → MANAGE_DEFAULT_VIEW 동반 부여 (멱등)
    conn.execute(sa.text(
        """
        INSERT INTO bip.report_permissions (report_id, subject_type, subject_id, permission)
        SELECT src.report_id, src.subject_type, src.subject_id, 'MANAGE_DEFAULT_VIEW'
        FROM bip.report_permissions src
        WHERE src.permission = 'MANAGE_REPORT'
          AND NOT EXISTS (
              SELECT 1 FROM bip.report_permissions dst
              WHERE dst.report_id = src.report_id
                AND dst.subject_type = src.subject_type
                AND dst.subject_id = src.subject_id
                AND dst.permission = 'MANAGE_DEFAULT_VIEW'
          )
        """
    ))

    # 3) 조회 전제 권한 보유 주체에 VIEW 보정 (멱등)
    conn.execute(sa.text(
        """
        INSERT INTO bip.report_permissions (report_id, subject_type, subject_id, permission)
        SELECT DISTINCT src.report_id, src.subject_type, src.subject_id, 'VIEW'
        FROM bip.report_permissions src
        WHERE src.permission = ANY(:actions)
          AND NOT EXISTS (
              SELECT 1 FROM bip.report_permissions dst
              WHERE dst.report_id = src.report_id
                AND dst.subject_type = src.subject_type
                AND dst.subject_id = src.subject_id
                AND dst.permission = 'VIEW'
          )
        """
    ), {"actions": list(_ACTIONS_IMPLYING_VIEW)})


def downgrade() -> None:
    """분리로 생긴 새 권한 코드만 제거한다.

    삭제된 menu_permissions 행과 3)에서 보정한 VIEW 행은 복원하지 않는다
    (원래 값을 구분할 정보가 남아 있지 않다).
    """
    conn = op.get_bind()
    conn.execute(sa.text(
        "DELETE FROM bip.report_permissions "
        "WHERE permission IN ('MANAGE_DEFAULT_VIEW', 'DOWNLOAD_PBIX')"
    ))
