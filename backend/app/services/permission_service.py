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
    return {r[0] for r in rows.all()}

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
