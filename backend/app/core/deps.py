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
    redis: RedisDep,
) -> PowerBIClient:
    if settings.APP_MODE == "mock":
        # redis를 넘겨 수동 트리거/취소된 refresh를 상태 있게 시뮬레이션한다(중지 버튼이
        # mock 모드에서도 실제로 Unknown -> Cancelled 흐름을 거치게 함).
        return MockPowerBIClient(redis=redis)
    return LivePowerBIClient(settings=settings, token_service=token_service)

PowerBIClientDep = Annotated[PowerBIClient, Depends(get_powerbi_client)]


# ===== 인증/권한 의존성 (T-12) =====
from fastapi import Cookie, Request
from sqlalchemy import select, text
from app.core.errors import UnauthenticatedError, PermissionDeniedError
from app.core.constants import RoleCode, ALL_MENU_KEYS, ROLE_MENUS
from app.models.auth import User, UserRole, Role
from app.services.auth import session_service

SESSION_COOKIE_NAME = "bip_session"


def _allowed_menus_for_roles(role_codes: list[str]) -> list[str]:
    """역할 집합의 메뉴 권한 합집합(코드 고정 매핑). System_Operator는 전체."""
    if RoleCode.SYSTEM_OPERATOR.value in role_codes:
        return list(ALL_MENU_KEYS)
    menus: set[str] = set()
    for code in role_codes:
        menus.update(ROLE_MENUS.get(code, []))
    return [k for k in ALL_MENU_KEYS if k in menus]


async def _granted_menu_keys(db: AsyncSession, user_id: int) -> set[str]:
    """사용자/소속 그룹에 개별 부여된 메뉴 권한(menu_permissions) 합집합.

    권한 관리 개편(그룹 중심) — 역할 고정 매핑(ROLE_MENUS)에 더해 관리자가
    그룹 또는 사용자 단위로 통계 등 메뉴 접근을 추가 부여할 수 있다.
    """
    rows = await db.execute(text(
        """
        SELECT menu_key FROM bip.menu_permissions
        WHERE (subject_type = 'user' AND subject_id = :user_id)
           OR (subject_type = 'group' AND subject_id IN (
                  SELECT group_id FROM bip.user_group_members WHERE user_id = :user_id))
        """
    ), {"user_id": user_id})
    return {r[0] for r in rows.all()}


async def _compute_allowed_menus(db: AsyncSession, user_id: int, role_codes: list[str]) -> list[str]:
    """role_codes(이미 조회된 역할)로부터 최종 메뉴 권한 합집합을 계산.

    역할 고정 매핑 ∪ 사용자/그룹 개별 부여(menu_permissions). System_Operator는 항상 전체.
    """
    if RoleCode.SYSTEM_OPERATOR.value in role_codes:
        return list(ALL_MENU_KEYS)
    menus = set(_allowed_menus_for_roles(role_codes))
    menus.update(await _granted_menu_keys(db, user_id))
    return [k for k in ALL_MENU_KEYS if k in menus]


async def allowed_menus_for_user(db: AsyncSession, user_id: int) -> list[str]:
    """user_id의 메뉴 권한 합집합 (로그인 응답 등에서 사용)."""
    codes = (await db.execute(
        select(Role.code)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user_id)
    )).scalars().all()
    return await _compute_allowed_menus(db, user_id, list(codes))


async def get_current_user(
    db: SessionDep,
    redis: RedisDep,
    bip_session: str | None = Cookie(default=None),
) -> dict:
    """세션 쿠키로 현재 사용자를 해석. 없거나 만료면 401.

    반환: {user_id, emp_no, name, roles:[...], allowed_menus:[...], is_active}
    """
    session = await session_service.get_session(redis, bip_session)
    if session is None:
        raise UnauthenticatedError()

    # 로컬 관리자(비상): users 테이블과 독립이므로 세션 페이로드를 신뢰한다. 전체 메뉴.
    if session.get("is_local_admin"):
        return {
            "user_id": session.get("user_id"),
            "emp_no": session.get("emp_no"),
            "name": session.get("name"),
            "roles": session.get("roles", []),
            "allowed_menus": list(ALL_MENU_KEYS),
            "is_active": True,
            "is_local_admin": True,
            "last_login_at": session.get("last_login_at"),
        }

    user_id = session.get("user_id")
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None or not user.is_active:
        # 비활성/삭제된 사용자는 세션 거부
        raise UnauthenticatedError()

    # 역할 조회 (code) + 메뉴 권한(코드 고정 매핑 ∪ 사용자/그룹 개별 부여)
    roles = list((await db.execute(
        select(Role.code)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user_id)
    )).scalars().all())
    allowed_menus = await _compute_allowed_menus(db, user_id, roles)

    return {
        "user_id": user.id,
        "emp_no": user.external_id,
        "name": user.name,
        "roles": roles,
        "allowed_menus": allowed_menus,
        "is_active": user.is_active,
        # 세션 생성(로그인) 시점에 기록해 둔 "직전 접속" 시각(ISO 문자열, 없으면 None).
        "last_login_at": session.get("last_login_at"),
    }

CurrentUserDep = Annotated[dict, Depends(get_current_user)]

def require_role(*allowed: str):
    """지정 역할 중 하나 이상 보유해야 통과하는 의존성 팩토리."""
    async def _checker(current=Depends(get_current_user)) -> dict:
        if not any(r in current["roles"] for r in allowed):
            raise PermissionDeniedError()
        return current
    return _checker


def require_menu(menu_key: str):
    """해당 메뉴(페이지) 접근 권한을 요구하는 의존성 팩토리.

    역할 → 메뉴 코드 고정 매핑(ROLE_MENUS) 기반. System_Operator/로컬관리자는 전체 허용.
    """
    async def _checker(current=Depends(get_current_user)) -> dict:
        roles = current.get("roles", [])
        if RoleCode.SYSTEM_OPERATOR.value in roles or current.get("is_local_admin"):
            return current
        if menu_key in current.get("allowed_menus", []):
            return current
        raise PermissionDeniedError()
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
            db, current["user_id"], report_id, action, roles=current.get("roles")
        )
        if not ok:
            raise PermissionDeniedError()
        return current
    return _checker
