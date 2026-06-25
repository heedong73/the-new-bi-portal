"""사용자 관리 라우트 — /api/users (System_Operator 전용)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.core.constants import AuditAction, RoleCode
from app.core.deps import SessionDep, RedisDep, require_role
from app.core.errors import NotFoundError
from app.models.auth import User, Role, UserRole
from app.schemas.user import UserListItem, UserStatusUpdate
from app.services.audit_service import append_audit
from app.services.auth import session_service

router = APIRouter(prefix="/api/users", tags=["users"])

_require_operator = require_role(RoleCode.SYSTEM_OPERATOR)

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
