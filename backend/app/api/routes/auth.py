"""인증 라우트 — /api/auth (로그인/로그아웃/현재 사용자)."""
from __future__ import annotations

from fastapi import APIRouter, Response, Cookie

from app.core.config import settings
from app.core.constants import AuditAction, RoleCode, ALL_MENU_KEYS
from app.core import deps
from app.core.deps import (
    SessionDep, RedisDep, CurrentUserDep,
    get_current_user, SESSION_COOKIE_NAME,
)
from app.core.errors import UnauthenticatedError
from app.schemas.auth import LoginRequest, LocalLoginRequest, LoginResponse, UserSummary
from app.services.auth import hr_authenticator, user_mapper, session_service, local_admin
from app.services.audit_service import append_audit
from sqlalchemy import select
from app.models.auth import Role, UserRole

router = APIRouter(prefix="/api/auth", tags=["auth"])

def _set_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_id,
        httponly=True,
        secure=settings.SESSION_COOKIE_SECURE,
        samesite=settings.SESSION_COOKIE_SAMESITE,
        # 쿠키 수명은 absolute 상한까지. 실제 idle 만료는 서버(Redis TTL)가 강제한다.
        max_age=settings.SESSION_ABSOLUTE_MINUTES * 60,
    )

async def _roles_for(db, user_id: int) -> list[str]:
    rows = await db.execute(
        select(Role.code).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == user_id)
    )
    return [r[0] for r in rows.all()]

@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, response: Response, db: SessionDep, redis: RedisDep):
    """사번/비밀번호 로그인 → 인사인증 → 매핑 → 세션 생성."""
    try:
        profile = await hr_authenticator.authenticate(db, body.emp_no, body.password)
    except hr_authenticator.AuthenticationError:
        await append_audit(db, action=AuditAction.LOGIN, result="failure",
                           actor_label=body.emp_no, meta={"emp_no": body.emp_no})
        await db.commit()
        raise UnauthenticatedError("사번 또는 비밀번호가 올바르지 않습니다.")

    user = await user_mapper.map_user(db, profile)
    if not user.is_active:
        await append_audit(db, action=AuditAction.LOGIN, result="failure",
                           actor_user_id=user.id, actor_label=user.external_id,
                           meta={"emp_no": user.external_id, "reason": "inactive"})
        await db.commit()
        raise UnauthenticatedError("비활성화된 계정입니다. 관리자에게 문의하세요.")

    roles = await _roles_for(db, user.id)
    session_id = await session_service.create_session(
        redis, user.id, {"emp_no": user.external_id, "name": user.name, "roles": roles}
    )
    await append_audit(db, action=AuditAction.LOGIN, result="success",
                       actor_user_id=user.id, actor_label=user.external_id,
                       meta={"emp_no": user.external_id})
    await db.commit()

    _set_session_cookie(response, session_id)
    return LoginResponse(user=UserSummary(
        id=user.id, emp_no=user.external_id, name=user.name,
        email=user.email, department_id=user.department_id, roles=roles,
        allowed_menus=await deps.allowed_menus_for_user(db, user.id),
    ))

@router.post("/local/login", response_model=LoginResponse)
async def local_login(body: LocalLoginRequest, response: Response, db: SessionDep, redis: RedisDep):
    """비상 로컬 관리자 로그인 → System_Operator 세션."""
    admin = await local_admin.authenticate_local_admin(db, redis, body.username, body.password)
    if admin is None:
        await append_audit(db, action=AuditAction.LOGIN, result="failure",
                           actor_label=body.username, meta={"username": body.username})
        await db.commit()
        raise UnauthenticatedError("로그인에 실패했습니다.")

    roles = [RoleCode.SYSTEM_OPERATOR.value]
    session_id = await session_service.create_session(
        redis, admin.id, {"emp_no": admin.username, "name": admin.username,
                          "roles": roles, "is_local_admin": True}
    )
    await append_audit(db, action=AuditAction.LOGIN, result="success",
                       actor_label=admin.username, meta={"username": admin.username})
    await db.commit()

    _set_session_cookie(response, session_id)
    return LoginResponse(user=UserSummary(
        id=admin.id, emp_no=admin.username, name=admin.username, roles=roles,
        allowed_menus=list(ALL_MENU_KEYS),
    ))

@router.post("/logout")
async def logout(
    response: Response,
    redis: RedisDep,
    bip_session: str | None = Cookie(default=None),
):
    """세션 무효화 + 쿠키 삭제."""
    if bip_session:
        await session_service.destroy_session(redis, bip_session)
    response.delete_cookie(SESSION_COOKIE_NAME)
    return {"status": "ok"}

@router.get("/me", response_model=UserSummary)
async def me(current: CurrentUserDep, db: SessionDep):
    """현재 로그인 사용자 요약."""
    from app.models.auth import User
    user = await db.scalar(select(User).where(User.id == current["user_id"]))
    return UserSummary(
        id=current["user_id"], emp_no=current["emp_no"], name=current["name"],
        email=user.email if user else None,
        department_id=user.department_id if user else None,
        roles=current["roles"],
        allowed_menus=current.get("allowed_menus", []),
    )
