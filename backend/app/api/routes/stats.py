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
from app.core.constants import AuditAction, RoleCode, PermissionAction
from app.core.deps import RedisDep, SessionDep, require_menu
from app.core.errors import PermissionDeniedError
from app.models.report import Report
from app.services import stats_service, permission_service
from app.services.audit_service import append_audit, build_audit_snapshot
from app.services.cache import cache_get_json, cache_set_json

router = APIRouter(tags=["stats"])


def _is_operator(current: dict) -> bool:
    return RoleCode.SYSTEM_OPERATOR.value in current.get("roles", []) or bool(current.get("is_local_admin"))


def _has_global_stats_scope(current: dict) -> bool:
    """관리 기능 없이 전체 통계만 읽는 담당임원도 전역 통계 스코프로 인정한다."""
    return _is_operator(current) or (
        RoleCode.EXECUTIVE_STATS_READER.value in current.get("roles", [])
    )


def _cache_key(prefix: str, from_dt: datetime | None, to_dt: datetime | None, scope: str = "all") -> str:
    return f"bip:cache:stats:{prefix}:{scope}:{from_dt or '-'}:{to_dt or '-'}"


async def _stats_report_ids(db, current: dict) -> set[int] | None:
    """전역 열람자는 전체(None), 작성자는 소유분과 VIEW_STATS 부여분의 합집합."""
    if _has_global_stats_scope(current):
        return None
    permitted = await permission_service.accessible_report_ids(
        db, current["user_id"], PermissionAction.VIEW_STATS, roles=current.get("roles")
    )
    owned = {
        report_id for (report_id,) in (await db.execute(
            select(Report.id).where(Report.created_by_user_id == current["user_id"])
        )).all()
    }
    return permitted | owned


async def _resolve_scope(
    db, current: dict, report_id: int | None = None, company_id: int | None = None,
) -> tuple[set[int] | None, str]:
    """현재 카탈로그 레포트 범위와 역할별 캐시 키를 계산한다.

    회사 단독 필터의 이벤트 집계는 별도로 report_company_id 스냅샷을 사용하되,
    현재 레포트 수·미사용 목록 등 카탈로그 지표에는 여기서 구한 ID 집합을 쓴다.
    """
    if _is_operator(current):
        cache_role = "operator"
    elif RoleCode.EXECUTIVE_STATS_READER.value in current.get("roles", []):
        cache_role = "executive"
    else:
        cache_role = f"author{current['user_id']}"

    def _key(scope: str) -> str:
        return f"{scope}:{cache_role}"

    allowed = await _stats_report_ids(db, current)  # None=all(global reader)
    if company_id is not None and report_id is None and allowed is not None:
        raise PermissionDeniedError("계열사 통계 필터는 전역 통계 열람자만 사용할 수 있습니다.")
    if report_id is not None:
        if allowed is not None and report_id not in allowed:
            raise PermissionDeniedError("해당 레포트의 통계를 조회할 권한이 없습니다.")
        if company_id is not None and allowed is None:
            company_ids = await stats_service.company_report_ids(db, company_id)
            if report_id not in company_ids:
                return set(), _key(f"r{report_id}c{company_id}")
            return {report_id}, _key(f"r{report_id}c{company_id}")
        return {report_id}, _key(f"r{report_id}")
    if company_id is not None and allowed is None:
        ids = await stats_service.company_report_ids(db, company_id)
        return ids, _key(f"c{company_id}")
    if allowed is None:
        return None, _key("all")
    return allowed, _key(f"u{current['user_id']}")


def _event_company_scope(
    report_id: int | None,
    company_id: int | None,
) -> int | None:
    """회사 단독 필터만 이벤트 기록 시점의 회사 스냅샷으로 집계한다."""
    return company_id if report_id is None else None


@router.get("/api/stats/reports")
async def stats_reports(
    company_id: int | None = Query(default=None, alias="company"),
    *,
    db: SessionDep,
    current: dict = Depends(require_menu("stats")),
):
    """통계를 볼 수 있는 레포트 목록. 전역 열람자=전체, 그 외=소유·VIEW_STATS 범위.

    company_id 지정(전역 열람자 전용) 시 그 계열사 소속 레포트만 반환 — 계열사 선택에
    맞춰 레포트 드롭다운도 좁혀 서로 다른 계열사를 고른 채 남는 UI 불일치를 막는다.
    """
    allowed = await _stats_report_ids(db, current)
    if company_id is not None and allowed is None:
        allowed = await stats_service.company_report_ids(db, company_id)
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
    company_id: int | None = Query(default=None, alias="company"),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """기본 운영 통계. report_id/계열사 지정 시 그 범위만; 운영자가 아니면 전역 지표 숨김.

    통계 대시보드 진입 시 항상 호출되는 대표 엔드포인트라, 감사 로그에는 이 호출
    1건만 `stats_view`로 기록한다(같은 화면의 usage/trends/hourly 등 나머지
    하위 위젯 호출까지 각각 남기면 "통계를 봤다"는 신호가 로그 볼륨에 묻힌다).
    """
    scope, scope_key = await _resolve_scope(db, current, report_id, company_id)
    key = _cache_key("overview", from_, to, scope_key)
    audit_report = (
        await db.scalar(select(Report).where(Report.id == report_id))
        if report_id is not None else None
    )
    actor_user_id = None if current.get("is_local_admin") else current.get("user_id")
    snapshot = await build_audit_snapshot(
        db, actor_user_id=actor_user_id, report=audit_report,
    )
    await append_audit(
        db,
        action=AuditAction.STATS_VIEW,
        result="success",
        actor_user_id=actor_user_id,
        actor_label=current.get("emp_no"),
        resource_type="report" if report_id is not None else "company" if company_id is not None else None,
        resource_id=str(report_id) if report_id is not None else (str(company_id) if company_id is not None else None),
        **snapshot,
    )
    await db.commit()
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_overview(
        db,
        from_,
        to,
        scope,
        company_id=_event_company_scope(report_id, company_id),
        include_system_activity=_is_operator(current),
    )
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data


@router.get("/api/stats/usage")
async def stats_usage(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    report_id: int | None = Query(default=None),
    company_id: int | None = Query(default=None, alias="company"),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """사용 통계. report_id/계열사 지정 시 그 범위로 스코프."""
    scope, scope_key = await _resolve_scope(db, current, report_id, company_id)
    key = _cache_key("usage", from_, to, scope_key)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_usage(
        db,
        from_,
        to,
        scope,
        company_id=_event_company_scope(report_id, company_id),
        include_system_activity=_is_operator(current),
    )
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data


@router.get("/api/stats/highlights")
async def stats_highlights(
    report_id: int | None = Query(default=None),
    company_id: int | None = Query(default=None, alias="company"),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """기간 필터와 무관한 상시 지표(오늘/어제 접속·최근 접속·미사용 레포트 수)."""
    scope, scope_key = await _resolve_scope(db, current, report_id, company_id)
    key = f"bip:cache:stats:highlights:{scope_key}"
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_highlights(
        db,
        scope,
        company_id=_event_company_scope(report_id, company_id),
    )
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data


@router.get("/api/stats/companies")
async def stats_companies(
    *,
    db: SessionDep,
    current: dict = Depends(require_menu("stats")),
):
    """계열사(최상위 폴더) 목록 — 전역 통계 열람자 필터 드롭다운용."""
    if not _has_global_stats_scope(current):
        return []
    return await stats_service.list_companies(db)


@router.get("/api/stats/trends")
async def stats_trends(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    granularity: str = Query(default="month"),
    report_id: int | None = Query(default=None),
    company_id: int | None = Query(default=None, alias="company"),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """일별/주별/월별 추이: 접속자 수·신규/누적 레포트 수·조회 수."""
    if granularity not in ("day", "week", "month"):
        granularity = "month"
    scope, scope_key = await _resolve_scope(db, current, report_id, company_id)
    key = _cache_key(f"trends:{granularity}", from_, to, scope_key)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_trends(
        db,
        from_,
        to,
        granularity,
        scope,
        company_id=_event_company_scope(report_id, company_id),
        include_system_activity=_is_operator(current),
    )
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data


@router.get("/api/stats/report-detail")
async def stats_report_detail(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    report_id: int | None = Query(default=None),
    company_id: int | None = Query(default=None, alias="company"),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """레포트별(또는 계열사별) 부서 조회 상세: 조회수·고유 사용자·최근 접속일."""
    scope, scope_key = await _resolve_scope(db, current, report_id, company_id)
    key = _cache_key("report-detail", from_, to, scope_key)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_report_detail(
        db,
        from_,
        to,
        scope,
        company_id=_event_company_scope(report_id, company_id),
    )
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data


@router.get("/api/stats/hourly")
async def stats_hourly(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    report_id: int | None = Query(default=None),
    company_id: int | None = Query(default=None, alias="company"),
    department_id: int | None = Query(default=None),
    unassigned_department: bool = Query(default=False),
    user_id: int | None = Query(default=None),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """시간대별(0~23시 KST) 조회 수·사용자 수. 부서/사용자 선택 시 그 범위로 드릴다운.

    부서 드릴다운은 표시 이름이 아닌 부서 ID로 필터링한다(코드→한글명으로 바뀐
    부서도 같은 범위로 묶기 위함). 부서 미지정 사용자는 unassigned_department로 선택한다.
    """
    scope, scope_key = await _resolve_scope(db, current, report_id, company_id)
    department_key = "none" if unassigned_department else (department_id or "-")
    key = _cache_key(f"hourly:{department_key}:{user_id or '-'}", from_, to, scope_key)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_hourly(
        db,
        from_,
        to,
        scope,
        company_id=_event_company_scope(report_id, company_id),
        department_id=department_id,
        unassigned_department=unassigned_department,
        user_id=user_id,
    )
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data


@router.get("/api/stats/raw-events")
async def stats_raw_events(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    report_id: int | None = Query(default=None),
    company_id: int | None = Query(default=None, alias="company"),
    *,
    db: SessionDep,
    current: dict = Depends(require_menu("stats")),
):
    """레포트 조회 로우 이벤트(일시/사용자/계열사/부서/레포트/체류시간) — 엑셀 다운로드용.

    Redis 캐시 없이 매 요청 최신 데이터를 반환한다(다운로드 목적상 스냅샷 일관성이
    캐시 적중률보다 중요하고, 캐시 크기가 응답에 비해 부담될 수 있어 생략).
    """
    scope, _ = await _resolve_scope(db, current, report_id, company_id)
    return await stats_service.get_raw_view_events(
        db,
        from_,
        to,
        scope,
        company_id=_event_company_scope(report_id, company_id),
    )


@router.get("/api/stats/report-detail-users")
async def stats_report_detail_users(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    report_id: int | None = Query(default=None),
    company_id: int | None = Query(default=None, alias="company"),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """레포트별(또는 계열사별) 사용자 조회 상세: 사용자명·부서·조회수·최근 접속일."""
    scope, scope_key = await _resolve_scope(db, current, report_id, company_id)
    key = _cache_key("report-detail-users", from_, to, scope_key)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_report_detail_users(
        db,
        from_,
        to,
        scope,
        company_id=_event_company_scope(report_id, company_id),
    )
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data


# ── 역할별 활동 분석(P1) / 참여도 인사이트(P2) ─────────────────────────────
@router.get("/api/stats/capabilities")
async def stats_capabilities(
    current: dict = Depends(require_menu("stats")),
):
    """프런트 정보구조 분기를 위한 현재 사용자의 통계 범위/역할 capability."""
    is_operator = _is_operator(current)
    is_executive = RoleCode.EXECUTIVE_STATS_READER.value in current.get("roles", [])
    return {
        "scope": "global" if _has_global_stats_scope(current) else "author",
        "is_operator": is_operator,
        "is_executive": is_executive,
        "can_view_global_activity": is_operator or is_executive,
        "can_view_system_operations": is_operator,
        "can_export_raw_events": True,
    }


@router.get("/api/stats/teams")
async def stats_teams(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    report_id: int | None = Query(default=None),
    company_id: int | None = Query(default=None, alias="company"),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """팀별 조회·다운로드·로그인·유효 참여 현황."""
    scope, scope_key = await _resolve_scope(db, current, report_id, company_id)
    key = _cache_key("teams", from_, to, scope_key)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_team_activity(
        db,
        from_,
        to,
        scope,
        company_id=_event_company_scope(report_id, company_id),
        include_system_activity=_is_operator(current),
    )
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data


@router.get("/api/stats/users")
async def stats_users(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    report_id: int | None = Query(default=None),
    company_id: int | None = Query(default=None, alias="company"),
    limit: int = Query(default=500, ge=1, le=2000),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """사용자별 조회·다운로드·로그인·체류 현황."""
    scope, scope_key = await _resolve_scope(db, current, report_id, company_id)
    key = _cache_key(f"users:{limit}", from_, to, scope_key)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_user_activity(
        db,
        from_,
        to,
        scope,
        company_id=_event_company_scope(report_id, company_id),
        include_system_activity=_is_operator(current),
        limit=limit,
    )
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data


@router.get("/api/stats/report-performance")
async def stats_report_performance(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    report_id: int | None = Query(default=None),
    company_id: int | None = Query(default=None, alias="company"),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """레포트별 조회·다운로드·도달·재방문·체류·직전기간 비교."""
    scope, scope_key = await _resolve_scope(db, current, report_id, company_id)
    key = _cache_key("report-performance", from_, to, scope_key)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_report_performance(
        db,
        from_,
        to,
        scope,
        company_id=_event_company_scope(report_id, company_id),
    )
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data


@router.get("/api/stats/lifecycle")
async def stats_lifecycle(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    report_id: int | None = Query(default=None),
    company_id: int | None = Query(default=None, alias="company"),
    limit: int = Query(default=200, ge=1, le=1000),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """감사 원장 기준 레포트 생성·수정·삭제 요약과 최근 이벤트."""
    scope, scope_key = await _resolve_scope(db, current, report_id, company_id)
    key = _cache_key(f"lifecycle:{limit}", from_, to, scope_key)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    owner_user_id = (
        current["user_id"]
        if not _has_global_stats_scope(current) and report_id is None and company_id is None
        else None
    )
    data = await stats_service.get_lifecycle_activity(
        db,
        from_,
        to,
        scope,
        company_id=_event_company_scope(report_id, company_id),
        owner_user_id=owner_user_id,
        limit=limit,
    )
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data


@router.get("/api/stats/insights")
async def stats_insights(
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = Query(default=None),
    report_id: int | None = Query(default=None),
    company_id: int | None = Query(default=None, alias="company"),
    *,
    db: SessionDep,
    redis: RedisDep,
    current: dict = Depends(require_menu("stats")),
):
    """도달률·재방문·유효 체류·동일기간 비교·미사용/급감 인사이트."""
    scope, scope_key = await _resolve_scope(db, current, report_id, company_id)
    key = _cache_key("insights", from_, to, scope_key)
    cached = await cache_get_json(redis, key)
    if cached is not None:
        return cached
    data = await stats_service.get_adoption_insights(
        db,
        from_,
        to,
        scope,
        company_id=_event_company_scope(report_id, company_id),
        include_system_activity=_is_operator(current),
    )
    await cache_set_json(redis, key, data, settings.CACHE_TTL_SECONDS)
    return data
