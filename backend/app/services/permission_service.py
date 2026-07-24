"""Permission_Service — 레포트 권한 합집합 계산 (4종 주체).

design.md "사용자 그룹 및 권한 계산 설계"(R8, R22, R24) 참조.
주체: user(직접) / role(역할) / dept(부서, users.department_id) / group(소속 그룹).
액션별(VIEW/DOWNLOAD/REFRESH/MANAGE_REPORT) 합집합으로 접근 가능 Report 집합 계산.
System_Operator는 모든 액션 보유로 간주(R24.3).
"""
from __future__ import annotations

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import PermissionAction, RoleCode, SubjectType
from app.models.auth import User, UserRole, Role
from app.models.report import Report, ReportPermission

async def _is_system_operator(db: AsyncSession, user_id: int) -> bool:
    code = await db.scalar(
        select(Role.code)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user_id, Role.code == RoleCode.SYSTEM_OPERATOR)
    )
    return code is not None

async def accessible_report_ids(
    db: AsyncSession, user_id: int, action: str = PermissionAction.VIEW,
    *, roles: list[str] | None = None,
) -> set[int]:
    """user_id가 action 권한을 가진 Report id 집합 (4종 주체 합집합).

    System_Operator면 전체 Report id 반환. 세션 roles 힌트에 System_Operator가
    있으면(로컬 관리자 포함) 즉시 운영자로 간주한다 — 로컬 관리자는 user_roles에
    매핑되지 않으므로 DB 조회만으로는 운영자 판별이 불가하기 때문.
    """
    is_operator = (roles is not None and RoleCode.SYSTEM_OPERATOR.value in roles) \
        or await _is_system_operator(db, user_id)
    if is_operator:
        rows = await db.execute(select(Report.id))
        return {r[0] for r in rows.all()}

    sql = text(
        """
        SELECT DISTINCT rp.report_id
        FROM bip.report_permissions rp
        WHERE rp.permission = :action AND (
            (rp.subject_type = 'user'  AND rp.subject_id = :user_id)
         OR (rp.subject_type = 'role'  AND rp.subject_id IN (
                SELECT role_id FROM bip.user_roles WHERE user_id = :user_id))
         OR (rp.subject_type = 'dept'  AND rp.subject_id = (
                SELECT department_id FROM bip.users WHERE id = :user_id))
         OR (rp.subject_type = 'group' AND rp.subject_id IN (
                SELECT group_id FROM bip.user_group_members WHERE user_id = :user_id))
        )
        """
    )
    rows = await db.execute(sql, {"action": action, "user_id": user_id})
    ids = {r[0] for r in rows.all()}

    # 그룹 "허용 계열사" 스코프 — VIEW만 자동 부여(권한 관리 개편, 확인사항 3).
    # 계열사(최상위 폴더) 하위 전체 레포트에 대해 소속 그룹 기준으로 합산한다.
    if action == PermissionAction.VIEW:
        scope_rows = await db.execute(text(
            """
            WITH RECURSIVE scoped_folders AS (
                SELECT gcs.root_folder_id AS folder_id
                FROM bip.group_company_scopes gcs
                WHERE gcs.group_id IN (
                    SELECT group_id FROM bip.user_group_members WHERE user_id = :user_id
                )
                UNION ALL
                -- 지정된 계열사(최상위 폴더) 하위 모든 폴더까지 재귀적으로 확장
                SELECT rf.id
                FROM bip.report_folders rf
                JOIN scoped_folders sf ON rf.parent_id = sf.folder_id
            )
            SELECT DISTINCT r.id
            FROM bip.reports r
            JOIN scoped_folders sf ON r.folder_id = sf.folder_id
            """
        ), {"user_id": user_id})
        ids.update(r[0] for r in scope_rows.all())
    return ids

async def has_permission(
    db: AsyncSession, user_id: int, report_id: int, action: str = PermissionAction.VIEW,
    *, roles: list[str] | None = None,
) -> bool:
    """user_id가 report_id에 대해 action 권한을 가지는지."""
    if (roles is not None and RoleCode.SYSTEM_OPERATOR.value in roles) \
            or await _is_system_operator(db, user_id):
        return True
    ids = await accessible_report_ids(db, user_id, action, roles=roles)
    return report_id in ids
