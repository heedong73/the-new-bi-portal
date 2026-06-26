"""통계 대시보드 API (T-33).

GET /api/stats/overview — 기본 운영 통계 (R18.1)
GET /api/stats/usage    — 사용 통계 (R18.2)

기간 필터(from/to) 지원, 집계 결과는 Redis 에 60s 캐시(R18.5).
접근 권한: System_Operator (R18.4).
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query

from app.core.config import settings
from app.core.constants import RoleCode, PermissionAction
from app.core.deps import RedisDep, SessionDep, require_menu
from app.services import stats_service, permission_service
from app.services.cache import cache_get_json, cache_set_json

router = APIRouter(tags=["stats"])


def _cache_key(prefix: str, from_dt: datetime | None, to_dt: datetime | None, scope: str = "all") -> str:
    return f"bip:cache:stats:{prefix}:{scope}:{from_dt or '-'}:{to_dt or '-'}"


async def _report_scope(db, current: dict) -> tuple[set[int] | None, str]:
    """통계 스코프 계산. System_Operator는 전체(None), 그 외(Super_User)는 부여 레포트만."""
    if RoleCode.SYSTEM_OPERATOR.value in current.get("roles", []) or current.get("is_local_admin"):
        return None, "all"
    ids = await permission_service.accessible_report_ids(
        db, current["user_id"], PermissionAction.VIEW
    )
    return ids, f"u{current['user_id']}"


@router.get("/api/stats/overview")
async def stats_overview(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """기본 운영 통계. Super_User는 부여 레포트 조회수만(전역 지표 숨김)."""
    scope, scope_key = await _report_scope(db, current)
    key = _cache_key("overview", from_, to, scope_key)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_overview(db, from_, to, scope)
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data


@router.get("/api/stats/usage")
async def stats_usage(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """사용 통계. Super_User는 부여 레포트로 스코프(전역 섹션 제외)."""
    scope, scope_key = await _report_scope(db, current)
    key = _cache_key("usage", from_, to, scope_key)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_usage(db, from_, to, scope)
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data
