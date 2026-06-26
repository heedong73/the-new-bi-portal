"""사용자 관리 공용 로직 — 인사 자동 등록 + 역할 레벨 설정.

org/users 라우트에서 공유한다. commit은 호출측에서 수행(조합 가능하도록).
"""
from __future__ import annotations

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import RoleCode
from app.models.auth import Role, User, UserRole
from app.services.auth import user_mapper
from app.services.auth.hr_authenticator import HRProfile

_ROLE_LEVELS = {
    RoleCode.GENERAL_USER.value,
    RoleCode.SUPER_USER.value,
    RoleCode.SYSTEM_OPERATOR.value,
}


async def register_from_hr(db: AsyncSession, emp_no: str) -> User | None:
    """재직(W) 인사 사용자를 BIP에 등록(+General_User). 없으면 None. (commit 안 함)"""
    urow = (await db.execute(text(
        "SELECT user_name, cmp_email, cmp_id FROM public.scl_v_insa_user "
        "WHERE emp_no = :e AND emp_status = 'W'"
    ), {"e": emp_no})).mappings().first()
    if urow is None:
        return None

    job = (await db.execute(text(
        "SELECT cmp_id, dept_id, ofc_id FROM public.scl_v_insa_my_job "
        "WHERE emp_no = :e ORDER BY (bass_dept_yn = 'Y') DESC, emp_sort_ordr ASC LIMIT 1"
    ), {"e": emp_no})).mappings().first()

    profile = HRProfile(
        emp_no=emp_no, user_name=urow["user_name"], cmp_email=urow["cmp_email"],
        cmp_id=(job["cmp_id"] if job else urow["cmp_id"]),
        dept_id=(job["dept_id"] if job else None),
        ofc_id=(job["ofc_id"] if job else None),
    )
    return await user_mapper.map_user(db, profile)


async def get_or_register(db: AsyncSession, emp_no: str) -> User | None:
    """BIP 사용자 조회, 없으면 인사에서 자동 등록. (commit 안 함)"""
    user = await db.scalar(select(User).where(User.external_id == emp_no))
    if user is not None:
        return user
    return await register_from_hr(db, emp_no)


def role_level_of(codes: set[str]) -> str | None:
    """역할 코드 집합 → 단일 레벨(최상위)."""
    if RoleCode.SYSTEM_OPERATOR.value in codes:
        return RoleCode.SYSTEM_OPERATOR.value
    if RoleCode.SUPER_USER.value in codes:
        return RoleCode.SUPER_USER.value
    if codes:
        return RoleCode.GENERAL_USER.value
    return None


async def set_role_level(db: AsyncSession, user_id: int, role_code: str) -> None:
    """역할 레벨 설정. General_User는 항상 유지, 상위 역할만 교체. (commit 안 함)"""
    roles = {r.code: r.id for r in (await db.execute(select(Role))).scalars().all()}
    target = {RoleCode.GENERAL_USER.value}
    if role_code == RoleCode.SUPER_USER.value:
        target.add(RoleCode.SUPER_USER.value)
    elif role_code == RoleCode.SYSTEM_OPERATOR.value:
        target.add(RoleCode.SYSTEM_OPERATOR.value)

    current = {
        code for (code,) in (await db.execute(
            select(Role.code).join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == user_id)
        )).all()
    }
    for code in target - current:
        if code in roles:
            db.add(UserRole(user_id=user_id, role_id=roles[code]))
    for code in (current - target) & _ROLE_LEVELS:
        if code in roles:
            await db.execute(delete(UserRole).where(
                UserRole.user_id == user_id, UserRole.role_id == roles[code]
            ))
    await db.flush()
