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
from datetime import datetime, timezone

from app.core.errors import UnauthenticatedError
from app.schemas.auth import LoginRequest, LocalLoginRequest, LoginResponse, UserSummary
from app.services.auth import (
    hr_authenticator, local_admin, local_user_auth, session_service, user_mapper,
)
from app.services.audit_service import append_audit
from sqlalchemy import select
from app.models.auth import Department, LocalAdmin, Role, User, UserRole

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

async def _department_name_for(db, department_id: int | None) -> str | None:
    if department_id is None:
        return None
    return await db.scalar(select(Department.name).where(Department.id == department_id))

@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, response: Response, db: SessionDep, redis: RedisDep):
    """로그인 → 세션 발급. 로컬 계정을 먼저 시도한 뒤 HR 인증으로 넘어간다.

    로컬 계정(is_local=True)은 관리자가 직접 만든 계정이며 argon2 해시로 비밀번호를
    검증한다. 아이디가 로컬 계정이 아니면 기존 HR 뷰 기반 인증으로 진행한다.
    """
    # 1) 로컬 계정 우선 시도. 계정이 존재하지 않으면 HR 흐름으로 fallthrough.
    local_user = await local_user_auth.find_local_user(db, body.emp_no)
    if local_user is not None:
        if not local_user.is_active:
            await append_audit(db, action=AuditAction.LOGIN, result="failure",
                               actor_user_id=local_user.id, actor_label=local_user.external_id,
                               meta={"emp_no": local_user.external_id,
                                     "reason": "inactive", "auth": "local"})
            await db.commit()
            raise UnauthenticatedError("비활성화된 계정입니다. 관리자에게 문의하세요.")

        verified = await local_user_auth.authenticate_local_user(
            db, redis, body.emp_no, body.password
        )
        if verified is None:
            await append_audit(db, action=AuditAction.LOGIN, result="failure",
                               actor_user_id=local_user.id, actor_label=local_user.external_id,
                               meta={"emp_no": local_user.external_id, "auth": "local"})
            await db.commit()
            raise UnauthenticatedError("아이디 또는 비밀번호가 올바르지 않습니다.")

        return await _issue_user_session(response, db, redis, verified, auth_source="local")

    # 2) HR 인증
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

    return await _issue_user_session(response, db, redis, user, auth_source="hr")


async def _issue_user_session(
    response: Response, db: SessionDep, redis: RedisDep, user: User, *, auth_source: str,
) -> LoginResponse:
    """User 인증 성공 후 last_login_at 갱신 · 세션 발급 · 감사 로그 · 응답 구성."""
    # 이번 로그인으로 갱신되기 "전"의 값을 응답/세션에 남겨 "마지막 접속"으로 보여준다.
    previous_login_at = user.last_login_at
    user.last_login_at = datetime.now(timezone.utc)

    roles = await _roles_for(db, user.id)
    session_id = await session_service.create_session(
        redis, user.id,
        {
            "emp_no": user.external_id, "name": user.name, "roles": roles,
            "last_login_at": previous_login_at.isoformat() if previous_login_at else None,
        },
    )
    await append_audit(db, action=AuditAction.LOGIN, result="success",
                       actor_user_id=user.id, actor_label=user.external_id,
                       meta={"emp_no": user.external_id, "auth": auth_source})
    await db.commit()

    _set_session_cookie(response, session_id)
    return LoginResponse(user=UserSummary(
        id=user.id, emp_no=user.external_id, name=user.name,
        email=user.email, department_id=user.department_id,
        department_name=await _department_name_for(db, user.department_id),
        roles=roles,
        allowed_menus=await deps.allowed_menus_for_user(db, user.id),
        last_login_at=previous_login_at,
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

    previous_login_at = admin.last_login_at
    admin.last_login_at = datetime.now(timezone.utc)

    roles = [RoleCode.SYSTEM_OPERATOR.value]
    session_id = await session_service.create_session(
        redis, admin.id,
        {
            "emp_no": admin.username, "name": admin.username,
            "roles": roles, "is_local_admin": True,
            "last_login_at": previous_login_at.isoformat() if previous_login_at else None,
        },
    )
    await append_audit(db, action=AuditAction.LOGIN, result="success",
                       actor_label=admin.username, meta={"username": admin.username})
    await db.commit()

    _set_session_cookie(response, session_id)
    return LoginResponse(user=UserSummary(
        id=admin.id, emp_no=admin.username, name=admin.username, roles=roles,
        allowed_menus=list(ALL_MENU_KEYS),
        last_login_at=previous_login_at,
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
    # local_admins와 users는 독립 PK 시퀀스를 사용하므로 ID가 우연히 겹쳐도
    # 일반 사용자의 조직 정보를 조회하지 않는다.
    user = None
    if not current.get("is_local_admin"):
        user = await db.scalar(select(User).where(User.id == current["user_id"]))
    # "마지막 접속"은 이번 세션 로그인 시점 이전 값을 세션 payload에서 그대로 읽는다
    # (last_login_at 컬럼은 로그인 시점에 "지금"으로 갱신되므로, 세션이 유지되는 동안
    # 화면은 계속 "직전 접속" 시각을 보여줘야 한다).
    raw_last_login = current.get("last_login_at")
    last_login_at = datetime.fromisoformat(raw_last_login) if raw_last_login else None
    return UserSummary(
        id=current["user_id"], emp_no=current["emp_no"], name=current["name"],
        email=user.email if user else None,
        department_id=user.department_id if user else None,
        department_name=await _department_name_for(db, user.department_id if user else None),
        roles=current["roles"],
        allowed_menus=current.get("allowed_menus", []),
        last_login_at=last_login_at,
    )
