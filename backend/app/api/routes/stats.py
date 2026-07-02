"""통계 대시보드 API (T-33).

GET /api/stats/overview — 기본 운영 통계 (R18.1)
GET /api/stats/usage    — 사용 통계 (R18.2)

기간 필터(from/to) 지원, 집계 결과는 Redis 에 60s 캐시(R18.5).
접근 권한: System_Operator (R18.4).
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.core.config import settings
from app.core.constants import RoleCode, PermissionAction
from app.core.deps import RedisDep, SessionDep, require_menu
from app.core.errors import PermissionDeniedError
from app.models.report import Report
from app.services import stats_service, permission_service
from app.services.cache import cache_get_json, cache_set_json

router = APIRouter(tags=["stats"])


def _is_operator(current: dict) -> bool:
    return RoleCode.SYSTEM_OPERATOR.value in current.get("roles", []) or bool(current.get("is_local_admin"))


def _cache_key(prefix: str, from_dt: datetime | None, to_dt: datetime | None, scope: str = "all") -> str:
    return f"bip:cache:stats:{prefix}:{scope}:{from_dt or '-'}:{to_dt or '-'}"


async def _stats_report_ids(db, current: dict) -> set[int] | None:
    """통계 열람 가능 레포트 id 집합. 운영자는 전체(None), 그 외는 VIEW_STATS 부여분."""
    if _is_operator(current):
        return None
    return await permission_service.accessible_report_ids(
        db, current["user_id"], PermissionAction.VIEW_STATS
    )


async def _resolve_scope(db, current: dict, report_id: int | None) -> tuple[set[int] | None, str]:
    """요청 스코프 계산.

    - report_id 지정: 그 레포트로 한정(운영자 아니면 VIEW_STATS 보유 검증).
    - 미지정: 운영자=전체(None), 그 외=VIEW_STATS 부여분 전체.
    """
    allowed = await _stats_report_ids(db, current)  # None=all(operator)
    if report_id is not None:
        if allowed is not None and report_id not in allowed:
            raise PermissionDeniedError("해당 레포트의 통계를 조회할 권한이 없습니다.")
        return {report_id}, f"r{report_id}"
    if allowed is None:
        return None, "all"
    return allowed, f"u{current['user_id']}"


@router.get("/api/stats/reports")
async def stats_reports(
    *,
    db: SessionDep,
    current: dict = Depends(require_menu("stats")),
):
    """통계를 볼 수 있는 레포트 목록(드롭다운용). 운영자=전체, Super_User=VIEW_STATS 부여분."""
    allowed = await _stats_report_ids(db, current)
    stmt = select(Report.id, Report.display_name, Report.report_name, Report.report_id).order_by(Report.sort_order, Report.id)
    if allowed is not None:
        if not allowed:
            return []
        stmt = stmt.where(Report.id.in_(allowed))
    rows = (await db.execute(stmt)).all()
    return [
        {"id": rid, "name": display or name or pbi_id}
        for rid, display, name, pbi_id in rows
    ]


@router.get("/api/stats/overview")
async def stats_overview(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    report_id: int | None = Query(default=None),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """기본 운영 통계. report_id 지정 시 그 레포트만; Super_User는 전역 지표 숨김."""
    scope, scope_key = await _resolve_scope(db, current, report_id)
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
    report_id: int | None = Query(default=None),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """사용 통계. report_id 지정 시 그 레포트로 스코프."""
    scope, scope_key = await _resolve_scope(db, current, report_id)
    key = _cache_key("usage", from_, to, scope_key)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_usage(db, from_, to, scope)
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data
