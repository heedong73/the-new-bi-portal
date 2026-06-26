"""사용자 관리 라우트 — /api/users (System_Operator 전용)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.core.constants import AuditAction, RoleCode
from app.core.deps import SessionDep, RedisDep, require_menu
from app.core.errors import NotFoundError
from app.models.auth import User, Role, UserRole
from app.schemas.user import UserListItem, UserStatusUpdate
from app.services.audit_service import append_audit
from app.services.auth import session_service

router = APIRouter(prefix="/api/users", tags=["users"])

_require_operator = require_menu("admin_users")

async def _roles_for(db, user_id: int) -> list[str]:
    rows = await db.execute(
        select(Role.code).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == user_id)
    )
    return [r[0] for r in rows.all()]

@router.get("", response_model=list[UserListItem])
async def list_users(db: SessionDep, _operator=Depends(_require_operator)):
    """전체 사용자 목록 (식별자/이름/부서/메일/역할/활성)."""
    users = (await db.execute(select(User).order_by(User.id))).scalars().all()
    result = []
    for u in users:
        result.append(UserListItem(
            id=u.id, emp_no=u.external_id, name=u.name, email=u.email,
            department_id=u.department_id, roles=await _roles_for(db, u.id),
            is_active=u.is_active,
        ))
    return result

@router.patch("/{user_id}/status", response_model=UserListItem)
async def update_status(
    user_id: int,
    body: UserStatusUpdate,
    db: SessionDep,
    redis: RedisDep,
    operator=Depends(_require_operator),
):
    """사용자 활성/비활성 전환. 비활성화 시 모든 세션 즉시 무효화(R4.3)."""
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise NotFoundError("사용자를 찾을 수 없습니다.")

    user.is_active = body.is_active
    await db.flush()

    # 비활성화 시 해당 사용자의 모든 활성 세션 즉시 삭제
    if not body.is_active:
        await session_service.destroy_user_sessions(redis, user_id)

    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=operator["user_id"], actor_label=operator["emp_no"],
        resource_type="user", resource_id=str(user_id),
        meta={"target": "user_status", "after": "active" if body.is_active else "inactive"},
    )
    await db.commit()

    return UserListItem(
        id=user.id, emp_no=user.external_id, name=user.name, email=user.email,
        department_id=user.department_id, roles=await _roles_for(db, user.id),
        is_active=user.is_active,
    )


@router.put("/{user_id}/group", status_code=204)
async def set_user_group(
    user_id: int, body: GroupAssignRequest, db: SessionDep, op=Depends(_require_operator),
):
    """사용자의 권한 그룹을 단일 값으로 설정(교체). group_id=None이면 해제."""
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise NotFoundError("사용자를 찾을 수 없습니다.")

    if body.group_id is not None:
        group = await db.scalar(select(UserGroup).where(UserGroup.id == body.group_id))
        if group is None:
            raise NotFoundError("그룹을 찾을 수 없습니다.")

    # 기존 그룹 전부 제거 후 단일 그룹 지정
    await db.execute(delete(UserGroupMember).where(UserGroupMember.user_id == user_id))
    if body.group_id is not None:
        db.add(UserGroupMember(group_id=body.group_id, user_id=user_id))
    await db.flush()
    await append_audit(
        db, action=AuditAction.GROUP_CHANGE, result="success",
        actor_user_id=op["user_id"], actor_label=op["emp_no"],
        resource_type="user", resource_id=str(user_id),
        meta={"target": "set_group", "group_id": body.group_id},
    )
    await db.commit()


@router.put("/{user_id}/role-level", status_code=204)
async def set_role_level(
    user_id: int, body: RoleLevelRequest, db: SessionDep, op=Depends(_require_operator),
):
    """사용자 역할 레벨 설정. General_User는 항상 유지하고 상위 역할만 교체한다.

    - General_User: 상위 역할(Super_User/System_Operator) 제거
    - Super_User: General_User + Super_User (System_Operator 제거)
    - System_Operator: General_User + System_Operator (Super_User 제거)
    """
    if body.role_code not in _ROLE_LEVELS:
        raise ValidationError("허용되지 않은 역할입니다.")

    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise NotFoundError("사용자를 찾을 수 없습니다.")

    roles = {
        r.code: r.id
        for r in (await db.execute(select(Role))).scalars().all()
    }
    # 목표 역할 집합
    target = {RoleCode.GENERAL_USER.value}
    if body.role_code == RoleCode.SUPER_USER.value:
        target.add(RoleCode.SUPER_USER.value)
    elif body.role_code == RoleCode.SYSTEM_OPERATOR.value:
        target.add(RoleCode.SYSTEM_OPERATOR.value)

    current = {
        code
        for (code,) in (await db.execute(
            select(Role.code).join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == user_id)
        )).all()
    }
    # 추가
    for code in target - current:
        if code in roles:
            db.add(UserRole(user_id=user_id, role_id=roles[code]))
    # 제거 (목표에 없는 관리 역할)
    for code in (current - target) & _ROLE_LEVELS:
        if code in roles:
            await db.execute(delete(UserRole).where(
                UserRole.user_id == user_id, UserRole.role_id == roles[code]
            ))
    await db.flush()
    await append_audit(
        db, action=AuditAction.PERMISSION_CHANGE, result="success",
        actor_user_id=op["user_id"], actor_label=op["emp_no"],
        resource_type="user_role", resource_id=str(user_id),
        meta={"target": "set_role_level", "role_code": body.role_code},
    )
    await db.commit()
