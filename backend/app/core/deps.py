from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings, Settings
from app.db.redis import get_redis
from app.db.session import get_db
from app.services.powerbi.client import PowerBIClient
from app.services.powerbi.live_client import LivePowerBIClient
from app.services.powerbi.mock_client import MockPowerBIClient
from app.services.powerbi.token_service import (
    MockTokenService,
    TokenService,
    TokenServiceProtocol,
)

SessionDep = Annotated[AsyncSession, Depends(get_db)]
RedisDep = Annotated[Redis, Depends(get_redis)]

def get_settings() -> Settings:
    return settings

SettingsDep = Annotated[Settings, Depends(get_settings)]

async def get_token_service(redis: RedisDep) -> TokenServiceProtocol:
    if settings.APP_MODE == "mock":
        return MockTokenService()
    return TokenService(settings=settings, redis=redis)

TokenServiceDep = Annotated[TokenServiceProtocol, Depends(get_token_service)]

async def get_powerbi_client(
    token_service: TokenServiceDep,
) -> PowerBIClient:
    if settings.APP_MODE == "mock":
        return MockPowerBIClient()
    return LivePowerBIClient(settings=settings, token_service=token_service)

PowerBIClientDep = Annotated[PowerBIClient, Depends(get_powerbi_client)]


# ===== 인증/권한 의존성 (T-12) =====
from fastapi import Cookie, Request
from sqlalchemy import select
from app.core.errors import UnauthenticatedError, PermissionDeniedError
from app.models.auth import User, UserRole, Role
from app.services.auth import session_service

SESSION_COOKIE_NAME = "bip_session"

async def get_current_user(
    db: SessionDep,
    redis: RedisDep,
    bip_session: str | None = Cookie(default=None),
) -> dict:
    """세션 쿠키로 현재 사용자를 해석. 없거나 만료면 401.

    반환: {user_id, emp_no, name, roles:[...], is_active}
    """
    session = await session_service.get_session(redis, bip_session)
    if session is None:
        raise UnauthenticatedError()

    # 로컬 관리자(비상): users 테이블과 독립이므로 세션 페이로드를 신뢰한다.
    if session.get("is_local_admin"):
        return {
            "user_id": session.get("user_id"),
            "emp_no": session.get("emp_no"),
            "name": session.get("name"),
            "roles": session.get("roles", []),
            "is_active": True,
            "is_local_admin": True,
        }

    user_id = session.get("user_id")
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None or not user.is_active:
        # 비활성/삭제된 사용자는 세션 거부
        raise UnauthenticatedError()

    # 역할 조회
    role_rows = await db.execute(
        select(Role.code)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user_id)
    )
    roles = [r[0] for r in role_rows.all()]

    return {
        "user_id": user.id,
        "emp_no": user.external_id,
        "name": user.name,
        "roles": roles,
        "is_active": user.is_active,
    }

CurrentUserDep = Annotated[dict, Depends(get_current_user)]

def require_role(*allowed: str):
    """지정 역할 중 하나 이상 보유해야 통과하는 의존성 팩토리."""
    async def _checker(current=Depends(get_current_user)) -> dict:
        if not any(r in current["roles"] for r in allowed):
            raise PermissionDeniedError()
        return current
    return _checker


# ===== 레포트 권한 의존성 (T-13) =====
from app.services import permission_service
from app.core.constants import PermissionAction

def require_report_permission(action: str = PermissionAction.VIEW):
    """해당 report_id에 대해 action 권한을 요구하는 의존성 팩토리.

    경로에 {report_id: int}가 있는 라우트에서 사용.
    """
    async def _checker(
        report_id: int,
        db: SessionDep,
        current=Depends(get_current_user),
    ) -> dict:
        ok = await permission_service.has_permission(
            db, current["user_id"], report_id, action
        )
        if not ok:
            raise PermissionDeniedError()
        return current
    return _checker
