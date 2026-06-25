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
from app.core.constants import RoleCode
from app.core.deps import RedisDep, SessionDep, require_role
from app.services import stats_service
from app.services.cache import cache_get_json, cache_set_json

router = APIRouter(tags=["stats"])


def _cache_key(prefix: str, from_dt: datetime | None, to_dt: datetime | None) -> str:
    return f"bip:cache:stats:{prefix}:{from_dt or '-'}:{to_dt or '-'}"


@router.get("/api/stats/overview")
async def stats_overview(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_role(RoleCode.SYSTEM_OPERATOR)),
):
    """기본 운영 통계: 로그인/조회/새로고침/메일 성공·실패 + 실패 Job 수."""
    key = _cache_key("overview", from_, to)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_overview(db, from_, to)
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data


@router.get("/api/stats/usage")
async def stats_usage(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_role(RoleCode.SYSTEM_OPERATOR)),
):
    """사용 통계: TOP10/부서별/월별/사용자별/메일/Export/Refresh실패/미사용."""
    key = _cache_key("usage", from_, to)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_usage(db, from_, to)
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data
