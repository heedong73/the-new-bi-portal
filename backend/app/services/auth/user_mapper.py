"""User_Mapper — 인사 프로필 → BIP 사용자 자동 매핑.

design.md "사용자 자동 매핑"(R3) 참조.
- 최초 로그인: departments/users 생성 + General_User 부여
- 재로그인: 부서/직급/cmp_email 변경 시 갱신
- external_id = emp_no, departments.external_id = dept_id
인사 뷰는 읽기 전용. 쓰기는 BIP 테이블(bip 스키마)에만.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import RoleCode
from app.models.auth import Department, Role, User, UserRole
from app.services.auth.hr_authenticator import HRProfile

async def _get_or_create_department(db: AsyncSession, profile: HRProfile) -> int | None:
    """dept_id로 department 조회/생성. dept_id 없으면 None."""
    if not profile.dept_id:
        return None
    dept = await db.scalar(
        select(Department).where(Department.external_id == profile.dept_id)
    )
    if dept is None:
        dept = Department(external_id=profile.dept_id, name=profile.dept_id)
        db.add(dept)
        await db.flush()
    return dept.id

async def map_user(db: AsyncSession, profile: HRProfile) -> User:
    """인사 프로필로 BIP 사용자 생성/갱신 후 반환.

    최초: users 생성 + General_User 부여.
    재로그인: name/email/job_title/department_id 변경 시 갱신.
    """
    department_id = await _get_or_create_department(db, profile)

    user = await db.scalar(select(User).where(User.external_id == profile.emp_no))

    if user is None:
        # 최초 로그인: 생성 + 기본 역할 부여
        user = User(
            external_id=profile.emp_no,
            name=profile.user_name,
            email=profile.cmp_email,
            job_title=profile.ofc_id,
            department_id=department_id,
            is_active=True,
        )
        db.add(user)
        await db.flush()

        general_role = await db.scalar(
            select(Role).where(Role.code == RoleCode.GENERAL_USER)
        )
        if general_role is not None:
            db.add(UserRole(user_id=user.id, role_id=general_role.id))
        await db.flush()
    else:
        # 재로그인: 변경분 갱신
        user.name = profile.user_name
        user.email = profile.cmp_email
        user.job_title = profile.ofc_id
        user.department_id = department_id
        await db.flush()

    return user
