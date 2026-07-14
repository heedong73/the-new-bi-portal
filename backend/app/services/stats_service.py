"""통계 집계 서비스 (T-33).

design.md / R18 참조. 별도 원장 없이 기존 테이블(audit_logs, reports,
refresh_runs, mail_jobs, export_jobs, users, departments)에 대한 집계 쿼리로 산출한다.

기간 필터(from/to)는 시간 경계가 있는 지표에 적용한다. 시간 컬럼의 tz 표현이
테이블마다 달라(audit/mail=naive UTC, refresh=tz-aware UTC) 비교 전에 정규화한다.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import distinct, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import (
    AuditAction,
    ExportStatus,
    MailJobStatus,
    RefreshStatus,
)
from app.models.auth import Department, User
from app.models.log import AuditLog
from app.models.mail import ExportJob, MailJob
from app.models.refresh import RefreshRun
from app.models.report import Report, ReportFolder


def _as_naive_utc(dt: datetime | None) -> datetime | None:
    """naive UTC 로 정규화 (audit_logs/mail_jobs 컬럼 비교용)."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _as_aware_utc(dt: datetime | None) -> datetime | None:
    """tz-aware UTC 로 정규화 (refresh_runs 컬럼 비교용)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def _count(db: AsyncSession, stmt) -> int:
    """select(...) 카운트 헬퍼."""
    return int(await db.scalar(stmt) or 0)


# ── 계열사(최상위 폴더)/KST 헬퍼 ─────────────────────────────────────────────
# 최상위 폴더명 → 계열사 표기 라벨 별칭(그 외는 폴더명 그대로). 예: SAMCHULLY→SCL.
_COMPANY_ALIASES: dict[str, str] = {"SAMCHULLY": "SCL"}


def _company_label(name: str | None) -> str:
    """최상위 폴더명을 계열사 표기 라벨로 변환."""
    if not name:
        return "(미지정)"
    return _COMPANY_ALIASES.get(name.strip().upper(), name)


def _kst(col):
    """naive UTC 컬럼을 KST 벽시계(naive)로 보정 — 시간대별/주·월 버킷팅용."""
    return col + text("interval '9 hours'")


async def _load_folder_parents(db: AsyncSession) -> tuple[dict[int, int | None], dict[int, str]]:
    """(folder_id→parent_id), (folder_id→name) 맵 반환."""
    folders = (await db.execute(select(ReportFolder))).scalars().all()
    return ({f.id: f.parent_id for f in folders}, {f.id: f.name for f in folders})


def _root_folder_id(folder_id: int | None, parent: dict[int, int | None]) -> int | None:
    """폴더의 최상위 조상 folder_id 반환(순환 방지)."""
    if folder_id is None:
        return None
    seen: set[int] = set()
    cur: int | None = folder_id
    while cur is not None and parent.get(cur) is not None and cur not in seen:
        seen.add(cur)
        cur = parent[cur]
    return cur


async def list_companies(db: AsyncSession) -> list[dict]:
    """계열사(최상위 폴더) 목록 [{company_id, label}] — 필터 드롭다운용."""
    folders = (await db.execute(
        select(ReportFolder)
        .where(ReportFolder.parent_id.is_(None))
        .order_by(ReportFolder.sort_order, ReportFolder.id)
    )).scalars().all()
    return [{"company_id": f.id, "label": _company_label(f.name)} for f in folders]


async def company_report_ids(db: AsyncSession, company_id: int) -> set[int]:
    """해당 계열사(최상위 폴더) 하위에 속한 모든 레포트 id 집합."""
    parent, _ = await _load_folder_parents(db)
    rows = (await db.execute(select(Report.id, Report.folder_id))).all()
    return {rid for rid, fid in rows if _root_folder_id(fid, parent) == company_id}


async def _reports_by_company(db: AsyncSession, report_ids: set[int] | None = None) -> list[dict]:
    """계열사(최상위 폴더)별 레포트 수. report_ids 지정 시 그 집합으로 한정."""
    parent, name = await _load_folder_parents(db)
    stmt = select(Report.id, Report.folder_id)
    if report_ids is not None:
        stmt = stmt.where(Report.id.in_(report_ids or {-1}))
    rows = (await db.execute(stmt)).all()
    counts: dict[int | None, int] = {}
    for _rid, fid in rows:
        root = _root_folder_id(fid, parent)
        counts[root] = counts.get(root, 0) + 1
    result = [
        {
            "company_id": root,
            "label": _company_label(name.get(root) if root else None),
            "count": cnt,
        }
        for root, cnt in counts.items()
    ]
    result.sort(key=lambda x: x["count"], reverse=True)
    return result


async def get_overview(
    db: AsyncSession, from_dt: datetime | None, to_dt: datetime | None,
    report_ids: set[int] | None = None,
) -> dict:
    """기본 운영 통계 (R18.1). report_ids 지정 시(Super_User) 해당 레포트 조회수만,
    시스템 전역 지표(로그인/새로고침/메일/실패Job)는 숨긴다."""
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)
    af, at = _as_aware_utc(from_dt), _as_aware_utc(to_dt)

    def _audit_range(stmt):
        if nf is not None:
            stmt = stmt.where(AuditLog.occurred_at_utc >= nf)
        if nt is not None:
            stmt = stmt.where(AuditLog.occurred_at_utc <= nt)
        return stmt

    def _report_created_range(stmt):
        if nf is not None:
            stmt = stmt.where(Report.created_at >= nf)
        if nt is not None:
            stmt = stmt.where(Report.created_at <= nt)
        return stmt

    # 스코프(Super_User VIEW_STATS 또는 운영자 계열사 필터): 조회 기준 지표만 노출.
    if report_ids is not None:
        scope_str = {str(i) for i in report_ids}
        if not scope_str:
            return {
                "scoped": True, "unique_visitors": 0, "total_visits": 0,
                "report_view_count": 0, "viewed_reports": 0,
                "total_reports": 0, "new_reports": 0,
            }

        def _view_scope(stmt):
            return _audit_range(stmt).where(
                AuditLog.action == AuditAction.REPORT_VIEW,
                AuditLog.resource_id.in_(scope_str),
            )

        report_view_count = await _count(db, _view_scope(
            select(func.count()).select_from(AuditLog)
        ))
        unique_visitors = await _count(db, _view_scope(
            select(func.count(distinct(AuditLog.actor_user_id))).select_from(AuditLog)
        ))
        viewed_reports = await _count(db, _view_scope(
            select(func.count(distinct(AuditLog.resource_id))).select_from(AuditLog)
        ))
        new_reports = await _count(db, _report_created_range(
            select(func.count()).select_from(Report).where(Report.id.in_(report_ids))
        ))
        return {
            "scoped": True,
            "unique_visitors": unique_visitors,
            "total_visits": report_view_count,
            "report_view_count": report_view_count,
            "viewed_reports": viewed_reports,
            "total_reports": len(report_ids),
            "new_reports": new_reports,
        }

    def _mail_range(stmt):
        if nf is not None:
            stmt = stmt.where(MailJob.started_at >= nf)
        if nt is not None:
            stmt = stmt.where(MailJob.started_at <= nt)
        return stmt

    def _refresh_range(stmt):
        if af is not None:
            stmt = stmt.where(RefreshRun.start_time_utc >= af)
        if at is not None:
            stmt = stmt.where(RefreshRun.start_time_utc <= at)
        return stmt

    login_count = await _count(db, _audit_range(
        select(func.count()).select_from(AuditLog).where(
            AuditLog.action == AuditAction.LOGIN, AuditLog.result == "success"
        )
    ))
    report_view_count = await _count(db, _audit_range(
        select(func.count()).select_from(AuditLog).where(
            AuditLog.action == AuditAction.REPORT_VIEW
        )
    ))
    refresh_success = await _count(db, _refresh_range(
        select(func.count()).select_from(RefreshRun).where(
            RefreshRun.status == RefreshStatus.SUCCESS
        )
    ))
    refresh_failed = await _count(db, _refresh_range(
        select(func.count()).select_from(RefreshRun).where(
            RefreshRun.status == RefreshStatus.FAILED
        )
    ))
    mail_success = await _count(db, _mail_range(
        select(func.count()).select_from(MailJob).where(
            MailJob.status == MailJobStatus.SUCCEEDED
        )
    ))
    mail_failed = await _count(db, _mail_range(
        select(func.count()).select_from(MailJob).where(
            MailJob.status == MailJobStatus.FAILED
        )
    ))
    export_failed = await _count(db,
        select(func.count()).select_from(ExportJob).where(
            ExportJob.status == ExportStatus.FAILED
        )
    )

    # 접속자(고유) / 접속 레포트 수 / 총·신규 레포트
    unique_login_users = await _count(db, _audit_range(
        select(func.count(distinct(AuditLog.actor_user_id))).select_from(AuditLog).where(
            AuditLog.action == AuditAction.LOGIN,
            AuditLog.result == "success",
            AuditLog.actor_user_id.is_not(None),
        )
    ))
    viewed_reports = await _count(db, _audit_range(
        select(func.count(distinct(AuditLog.resource_id))).select_from(AuditLog).where(
            AuditLog.action == AuditAction.REPORT_VIEW,
            AuditLog.resource_id.is_not(None),
        )
    ))
    total_reports = await _count(db, select(func.count()).select_from(Report))
    new_reports = await _count(db, _report_created_range(
        select(func.count()).select_from(Report)
    ))

    return {
        "unique_visitors": unique_login_users,
        "total_visits": login_count,
        "login_count": login_count,
        "unique_login_users": unique_login_users,
        "report_view_count": report_view_count,
        "viewed_reports": viewed_reports,
        "total_reports": total_reports,
        "new_reports": new_reports,
        "refresh_success": refresh_success,
        "refresh_failed": refresh_failed,
        "mail_success": mail_success,
        "mail_failed": mail_failed,
        "failed_job_count": mail_failed + export_failed,
    }


async def get_usage(
    db: AsyncSession, from_dt: datetime | None, to_dt: datetime | None,
    report_ids: set[int] | None = None,
) -> dict:
    """사용 통계 (R18.2). report_ids 지정 시(Super_User) 부여된 레포트로 스코프하고
    시스템 전역 섹션(메일/Export/Refresh실패)은 제외한다."""
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)
    scoped = report_ids is not None
    scope_str = {str(i) for i in report_ids} if scoped else None

    def _audit_view_range(stmt):
        stmt = stmt.where(AuditLog.action == AuditAction.REPORT_VIEW)
        if scoped:
            stmt = stmt.where(AuditLog.resource_id.in_(scope_str or {"__none__"}))
        if nf is not None:
            stmt = stmt.where(AuditLog.occurred_at_utc >= nf)
        if nt is not None:
            stmt = stmt.where(AuditLog.occurred_at_utc <= nt)
        return stmt

    # 인기 리포트 TOP 10 (조회 수 기준) — resource_id(문자열) 그룹핑 후 이름 매핑
    top_rows = (await db.execute(_audit_view_range(
        select(AuditLog.resource_id, func.count().label("cnt"))
        .select_from(AuditLog)
        .where(AuditLog.resource_id.is_not(None))
        .group_by(AuditLog.resource_id)
        .order_by(func.count().desc())
        .limit(10)
    ))).all()
    top_reports = await _attach_report_names(db, top_rows)

    # 사용자별 조회 수 (TOP 10)
    user_rows = (await db.execute(_audit_view_range(
        select(AuditLog.actor_user_id, func.count().label("cnt"))
        .select_from(AuditLog)
        .where(AuditLog.actor_user_id.is_not(None))
        .group_by(AuditLog.actor_user_id)
        .order_by(func.count().desc())
        .limit(10)
    ))).all()
    by_user = await _attach_user_names(db, user_rows)

    # 부서(폴더)별 게시 리포트 수 — reports.folder_id → report_folders 그룹핑
    folder_stmt = (
        select(ReportFolder.id, ReportFolder.name, func.count(Report.id).label("cnt"))
        .select_from(Report)
        .outerjoin(ReportFolder, ReportFolder.id == Report.folder_id)
    )
    if scoped:
        folder_stmt = folder_stmt.where(Report.id.in_(report_ids or {-1}))
    folder_rows = (await db.execute(
        folder_stmt.group_by(ReportFolder.id, ReportFolder.name)
        .order_by(func.count(Report.id).desc())
    )).all()
    reports_by_department = [
        {"folder_id": fid, "department": name or "(미지정)", "count": int(cnt)}
        for fid, name, cnt in folder_rows
    ]

    # 부서별 조회 수 (조회자 부서 기준)
    dept_rows = (await db.execute(_audit_view_range(
        select(Department.name, func.count().label("cnt"))
        .select_from(AuditLog)
        .join(User, User.id == AuditLog.actor_user_id)
        .join(Department, Department.id == User.department_id)
        .group_by(Department.name)
        .order_by(func.count().desc())
    ))).all()
    views_by_department = [{"department": name, "count": int(cnt)} for name, cnt in dept_rows]

    # 월별 등록 리포트 수
    month_expr = func.to_char(Report.created_at, "YYYY-MM")
    month_stmt = select(month_expr.label("month"), func.count().label("cnt"))
    if scoped:
        month_stmt = month_stmt.where(Report.id.in_(report_ids or {-1}))
    month_rows = (await db.execute(
        month_stmt.group_by(month_expr).order_by(month_expr)
    )).all()
    reports_by_month = [{"month": m, "count": int(c)} for m, c in month_rows]

    # 미사용 리포트 (UNUSED_REPORT_DAYS 동안 조회 이력 없는 공개 리포트)
    unused_reports = await _unused_reports(db, report_ids)

    # 계열사(최상위 폴더)별 레포트 수
    reports_by_company = await _reports_by_company(db, report_ids)

    # 시간대별(0~23시, KST) 조회 페이지수 / 고유 사용자 수
    hour_expr = func.extract("hour", _kst(AuditLog.occurred_at_utc))
    hour_rows = (await db.execute(_audit_view_range(
        select(
            hour_expr.label("hour"),
            func.count().label("views"),
            func.count(distinct(AuditLog.actor_user_id)).label("users"),
        ).select_from(AuditLog).group_by(hour_expr)
    ))).all()
    _hmap = {int(h): (int(v), int(u)) for h, v, u in hour_rows}
    hourly = [
        {"hour": h, "views": _hmap.get(h, (0, 0))[0], "users": _hmap.get(h, (0, 0))[1]}
        for h in range(24)
    ]

    # Super_User: 부여 레포트 사용 통계만, 시스템 전역 섹션 제외
    if scoped:
        return {
            "scoped": True,
            "top_reports": top_reports,
            "by_user": by_user,
            "reports_by_department": reports_by_department,
            "views_by_department": views_by_department,
            "reports_by_month": reports_by_month,
            "reports_by_company": reports_by_company,
            "hourly": hourly,
            "unused_reports": unused_reports,
        }

    # 스케줄 메일 발송 건수 (상태별)
    mail_total = await _count(db, select(func.count()).select_from(MailJob))
    mail_succeeded = await _count(db, select(func.count()).select_from(MailJob).where(
        MailJob.status == MailJobStatus.SUCCEEDED))
    mail_failed = await _count(db, select(func.count()).select_from(MailJob).where(
        MailJob.status == MailJobStatus.FAILED))

    # Export 성공/실패
    export_succeeded = await _count(db, select(func.count()).select_from(ExportJob).where(
        ExportJob.status == ExportStatus.SUCCEEDED))
    export_failed = await _count(db, select(func.count()).select_from(ExportJob).where(
        ExportJob.status == ExportStatus.FAILED))

    # Refresh 실패 현황
    refresh_failed = await _count(db, select(func.count()).select_from(RefreshRun).where(
        RefreshRun.status == RefreshStatus.FAILED))

    return {
        "top_reports": top_reports,
        "by_user": by_user,
        "reports_by_department": reports_by_department,
        "views_by_department": views_by_department,
        "reports_by_month": reports_by_month,
        "reports_by_company": reports_by_company,
        "hourly": hourly,
        "mail_jobs": {
            "total": mail_total,
            "succeeded": mail_succeeded,
            "failed": mail_failed,
        },
        "export_jobs": {"succeeded": export_succeeded, "failed": export_failed},
        "refresh_failed": refresh_failed,
        "unused_reports": unused_reports,
    }


async def _attach_report_names(db: AsyncSession, rows) -> list[dict]:
    """(resource_id, cnt) → [{report_id, report_name, count}]. 이름은 reports 매핑."""
    result: list[dict] = []
    for resource_id, cnt in rows:
        report_name = None
        try:
            rid = int(resource_id)
            report = await db.scalar(select(Report).where(Report.id == rid))
            if report is not None:
                report_name = report.display_name or report.report_name
        except (ValueError, TypeError):
            pass
        result.append({
            "report_id": resource_id,
            "report_name": report_name,
            "count": int(cnt),
        })
    return result


async def _attach_user_names(db: AsyncSession, rows) -> list[dict]:
    """(actor_user_id, cnt) → [{user_id, user_name, count}]."""
    result: list[dict] = []
    for user_id, cnt in rows:
        user = await db.scalar(select(User).where(User.id == user_id))
        result.append({
            "user_id": user_id,
            "user_name": user.name if user else None,
            "count": int(cnt),
        })
    return result


async def _unused_reports(db: AsyncSession, report_ids: set[int] | None = None) -> list[dict]:
    """UNUSED_REPORT_DAYS 동안 report_view 이력이 없는 공개 리포트 목록.
    report_ids 지정 시 해당 레포트로 한정(Super_User)."""
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
        days=settings.UNUSED_REPORT_DAYS
    )
    # 최근 조회된 리포트 id 집합 (resource_id 는 문자열로 저장됨)
    viewed_rows = (await db.execute(
        select(AuditLog.resource_id).where(
            AuditLog.action == AuditAction.REPORT_VIEW,
            AuditLog.occurred_at_utc >= cutoff,
            AuditLog.resource_id.is_not(None),
        ).distinct()
    )).all()
    viewed_ids: set[int] = set()
    for (rid,) in viewed_rows:
        try:
            viewed_ids.add(int(rid))
        except (ValueError, TypeError):
            continue

    stmt = select(Report).where(Report.is_published.is_(True))
    if report_ids is not None:
        stmt = stmt.where(Report.id.in_(report_ids or {-1}))
    published = (await db.execute(stmt)).scalars().all()
    return [
        {"report_id": r.id, "report_name": r.display_name or r.report_name}
        for r in published
        if r.id not in viewed_ids
    ]


async def get_highlights(
    db: AsyncSession,
    report_ids: set[int] | None = None,
) -> dict:
    """기간 필터와 무관한 상시 지표: 오늘/어제 접속(중복 미제거), 최근 접속 시각,
    미사용 레포트 수. 통계 화면 상단 기간 필터를 어떻게 바꿔도 항상 '오늘 vs 어제'
    기준을 유지한다(작성자 대시보드 KPI/인사이트용).

    report_ids 지정 시(Super_User) 그 범위로 한정. None이면 전체(운영자).
    """
    if report_ids is not None and not report_ids:
        return {
            "today_views": 0, "yesterday_views": 0, "pct_change": None, "is_new": False,
            "last_access": None, "unused_count": 0,
        }
    scope_str = {str(i) for i in report_ids} if report_ids is not None else None

    kst = timezone(timedelta(hours=9))
    now_kst = datetime.now(kst)
    today_start_kst = now_kst.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start_kst = today_start_kst - timedelta(days=1)
    tomorrow_start_kst = today_start_kst + timedelta(days=1)

    def _to_naive_utc(dt: datetime) -> datetime:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)

    today_start = _to_naive_utc(today_start_kst)
    tomorrow_start = _to_naive_utc(tomorrow_start_kst)
    yesterday_start = _to_naive_utc(yesterday_start_kst)

    def _view_stmt():
        stmt = select(func.count()).select_from(AuditLog).where(
            AuditLog.action == AuditAction.REPORT_VIEW,
        )
        if scope_str is not None:
            stmt = stmt.where(AuditLog.resource_id.in_(scope_str))
        return stmt

    today_views = await _count(db, _view_stmt().where(
        AuditLog.occurred_at_utc >= today_start, AuditLog.occurred_at_utc < tomorrow_start,
    ))
    yesterday_views = await _count(db, _view_stmt().where(
        AuditLog.occurred_at_utc >= yesterday_start, AuditLog.occurred_at_utc < today_start,
    ))

    is_new = yesterday_views == 0 and today_views > 0
    pct_change = None if yesterday_views == 0 else round(
        (today_views - yesterday_views) / yesterday_views * 100, 1
    )

    last_stmt = select(func.max(AuditLog.occurred_at_utc)).where(
        AuditLog.action == AuditAction.REPORT_VIEW
    )
    if scope_str is not None:
        last_stmt = last_stmt.where(AuditLog.resource_id.in_(scope_str))
    last = await db.scalar(last_stmt)
    last_access = last.replace(tzinfo=timezone.utc).isoformat() if last else None

    unused = await _unused_reports(db, report_ids)

    return {
        "today_views": today_views,
        "yesterday_views": yesterday_views,
        "pct_change": pct_change,
        "is_new": is_new,
        "last_access": last_access,
        "unused_count": len(unused),
    }


async def get_trends(
    db: AsyncSession,
    from_dt: datetime | None,
    to_dt: datetime | None,
    granularity: str = "month",
    report_ids: set[int] | None = None,
) -> dict:
    """일별/주별/월별 추이 (KST 버킷): 접속자 수·누적 레포트 수·신규 레포트 수·조회 수.

    - unique_users: 전역=로그인 고유 사용자, 스코프=해당 레포트 조회 고유 사용자
    - views: report_view 건수
    - new_reports: 그 버킷에 새로 등록된 레포트 수
    - total_reports: 각 버킷 끝까지의 누적 등록 레포트 수
    표시 버킷은 조회/로그인 활동이 있는 버킷의 합집합(기간 필터 반영)이며,
    누적 레포트 수는 전체 히스토리를 사전식 비교로 합산한다(라벨 zero-pad라 정합).
    """
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)
    scoped = report_ids is not None
    scope_str = {str(i) for i in report_ids} if scoped else None
    # 일(YYYY-MM-DD) / ISO 주(IYYY-Www) / 월(YYYY-MM). 주는 2자리 zero-pad라 사전식 비교 정합.
    if granularity == "day":
        fmt = "YYYY-MM-DD"
    elif granularity == "week":
        fmt = 'IYYY-"W"IW'
    else:
        fmt = "YYYY-MM"

    def _occurred_range(stmt):
        if nf is not None:
            stmt = stmt.where(AuditLog.occurred_at_utc >= nf)
        if nt is not None:
            stmt = stmt.where(AuditLog.occurred_at_utc <= nt)
        return stmt

    # 조회 수 + 조회 고유 사용자 (기간/스코프)
    v_label = func.to_char(_kst(AuditLog.occurred_at_utc), fmt)
    v_stmt = (
        select(
            v_label.label("bucket"),
            func.count().label("views"),
            func.count(distinct(AuditLog.actor_user_id)).label("vusers"),
        )
        .select_from(AuditLog)
        .where(AuditLog.action == AuditAction.REPORT_VIEW)
    )
    if scoped:
        v_stmt = v_stmt.where(AuditLog.resource_id.in_(scope_str or {"__none__"}))
    v_rows = (await db.execute(_occurred_range(v_stmt).group_by(v_label))).all()
    views_by = {b: (int(v), int(u)) for b, v, u in v_rows}

    # 로그인 고유 사용자 (전역일 때만; 스코프는 조회 고유 사용자를 사용)
    login_users_by: dict[str, int] = {}
    if not scoped:
        l_label = func.to_char(_kst(AuditLog.occurred_at_utc), fmt)
        l_stmt = (
            select(l_label.label("bucket"), func.count(distinct(AuditLog.actor_user_id)).label("u"))
            .select_from(AuditLog)
            .where(
                AuditLog.action == AuditAction.LOGIN,
                AuditLog.result == "success",
                AuditLog.actor_user_id.is_not(None),
            )
        )
        l_rows = (await db.execute(_occurred_range(l_stmt).group_by(l_label))).all()
        login_users_by = {b: int(u) for b, u in l_rows}

    # 레포트 신규 등록(버킷별, 전체 히스토리) — 누적 계산용
    r_label = func.to_char(_kst(Report.created_at), fmt)
    r_stmt = select(r_label.label("bucket"), func.count().label("c")).select_from(Report)
    if scoped:
        r_stmt = r_stmt.where(Report.id.in_(report_ids or {-1}))
    r_rows = (await db.execute(r_stmt.group_by(r_label))).all()
    new_by = {b: int(c) for b, c in r_rows}

    # 표시 버킷 = 조회/로그인/신규등록 버킷의 합집합, 정렬.
    # 신규등록 버킷은 그 시점에 조회/로그인이 없어도 등록 사실 자체를 보여주기 위해 항상 포함한다.
    buckets = sorted(set(views_by) | set(login_users_by) | set(new_by))

    series = []
    for b in buckets:
        views, vusers = views_by.get(b, (0, 0))
        users = vusers if scoped else login_users_by.get(b, 0)
        new_count = new_by.get(b, 0)
        cumulative = sum(c for lbl, c in new_by.items() if lbl <= b)
        series.append({
            "period": b,
            "unique_users": users,
            "views": views,
            "new_reports": new_count,
            "total_reports": cumulative,
        })
    return {"granularity": granularity, "scoped": scoped, "series": series}


async def get_report_detail(
    db: AsyncSession,
    from_dt: datetime | None,
    to_dt: datetime | None,
    report_ids: set[int] | None = None,
) -> list[dict]:
    """레포트별 조회 상세 — 부서별 조회수/고유 사용자/최근 접속.

    report_ids 지정 시 그 집합으로 한정(단일 레포트 또는 계열사 전체). None이면
    전체 레포트 대상(운영자). 조회자(actor)의 부서 기준으로 집계한다.
    """
    if report_ids is not None and not report_ids:
        return []
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)
    scope_str = {str(i) for i in report_ids} if report_ids is not None else None

    stmt = (
        select(
            Department.name.label("dept"),
            func.count().label("views"),
            func.count(distinct(AuditLog.actor_user_id)).label("users"),
            func.max(AuditLog.occurred_at_utc).label("last"),
        )
        .select_from(AuditLog)
        .join(User, User.id == AuditLog.actor_user_id)
        .outerjoin(Department, Department.id == User.department_id)
        .where(AuditLog.action == AuditAction.REPORT_VIEW)
    )
    if scope_str is not None:
        stmt = stmt.where(AuditLog.resource_id.in_(scope_str))
    if nf is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc >= nf)
    if nt is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc <= nt)
    stmt = stmt.group_by(Department.name).order_by(func.count().desc())

    rows = (await db.execute(stmt)).all()
    result: list[dict] = []
    for dept, views, users, last in rows:
        # naive UTC → tz-aware ISO(UTC). 프런트가 로컬로 표시.
        last_iso = last.replace(tzinfo=timezone.utc).isoformat() if last else None
        result.append({
            "department": dept or "(부서 없음)",
            "views": int(views),
            "unique_users": int(users),
            "last_access": last_iso,
        })
    return result


async def get_hourly(
    db: AsyncSession,
    from_dt: datetime | None,
    to_dt: datetime | None,
    report_ids: set[int] | None = None,
    *,
    department: str | None = None,
    user_id: int | None = None,
) -> list[dict]:
    """시간대별(0~23시, KST) 레포트 조회 수 / 고유 사용자 수.

    상세 조회 탭에서 특정 부서 또는 사용자를 선택했을 때, 그 부서/사용자로
    한정한 시간대별 추이를 보기 위한 드릴다운용(usage.hourly는 필터 없는 전체
    기준). department/user_id는 상호 배타적으로 쓰되 동시 지정도 AND로 허용한다.
    """
    if report_ids is not None and not report_ids:
        return [{"hour": h, "views": 0, "users": 0} for h in range(24)]
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)
    scope_str = {str(i) for i in report_ids} if report_ids is not None else None

    hour_expr = func.extract("hour", _kst(AuditLog.occurred_at_utc))
    stmt = (
        select(
            hour_expr.label("hour"),
            func.count().label("views"),
            func.count(distinct(AuditLog.actor_user_id)).label("users"),
        )
        .select_from(AuditLog)
        .where(AuditLog.action == AuditAction.REPORT_VIEW)
    )
    if department is not None or user_id is not None:
        stmt = stmt.join(User, User.id == AuditLog.actor_user_id)
        if department is not None:
            stmt = stmt.outerjoin(Department, Department.id == User.department_id).where(
                Department.name == department if department != "(부서 없음)" else Department.id.is_(None)
            )
        if user_id is not None:
            stmt = stmt.where(User.id == user_id)
    if scope_str is not None:
        stmt = stmt.where(AuditLog.resource_id.in_(scope_str))
    if nf is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc >= nf)
    if nt is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc <= nt)
    stmt = stmt.group_by(hour_expr)

    rows = (await db.execute(stmt)).all()
    hmap = {int(h): (int(v), int(u)) for h, v, u in rows}
    return [
        {"hour": h, "views": hmap.get(h, (0, 0))[0], "users": hmap.get(h, (0, 0))[1]}
        for h in range(24)
    ]


async def get_report_detail_users(
    db: AsyncSession,
    from_dt: datetime | None,
    to_dt: datetime | None,
    report_ids: set[int] | None = None,
) -> list[dict]:
    """레포트별 조회 상세 — 사용자별 조회수/부서/최근 접속.

    부서별 집계(get_report_detail)와 짝을 이루는 사용자 단위 상세. report_ids
    지정 시 그 집합으로 한정(단일 레포트 또는 계열사 전체). None이면 전체 대상.
    """
    if report_ids is not None and not report_ids:
        return []
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)
    scope_str = {str(i) for i in report_ids} if report_ids is not None else None

    stmt = (
        select(
            User.id.label("user_id"),
            User.name.label("user_name"),
            Department.name.label("dept"),
            func.count().label("views"),
            func.max(AuditLog.occurred_at_utc).label("last"),
        )
        .select_from(AuditLog)
        .join(User, User.id == AuditLog.actor_user_id)
        .outerjoin(Department, Department.id == User.department_id)
        .where(AuditLog.action == AuditAction.REPORT_VIEW)
    )
    if scope_str is not None:
        stmt = stmt.where(AuditLog.resource_id.in_(scope_str))
    if nf is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc >= nf)
    if nt is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc <= nt)
    stmt = stmt.group_by(User.id, User.name, Department.name).order_by(func.count().desc())

    rows = (await db.execute(stmt)).all()
    result: list[dict] = []
    for user_id, user_name, dept, views, last in rows:
        last_iso = last.replace(tzinfo=timezone.utc).isoformat() if last else None
        result.append({
            "user_id": user_id,
            "user_name": user_name or f"#{user_id}",
            "department": dept or "(부서 없음)",
            "views": int(views),
            "last_access": last_iso,
        })
    return result


async def get_raw_view_events(
    db: AsyncSession,
    from_dt: datetime | None,
    to_dt: datetime | None,
    report_ids: set[int] | None = None,
    *,
    limit: int = 50_000,
) -> list[dict]:
    """레포트 조회(report_view) 로우 이벤트 — 일시·사용자·계열사·부서·레포트·체류시간.

    한 행 = 한 번의 조회(Embed Token 발급) 이벤트. 작성자/운영자가 "레포트별로
    누가, 언제, 얼마나 봤는지"를 엑셀에서 자유롭게 피벗/필터링할 수 있도록 사전
    집계 없이 원본 단위로 내려준다. report_ids 지정 시 그 범위로 한정(None=전체).

    duration_seconds는 프런트가 탭 이탈 시점에 갱신하는 근사치이며, 아직 갱신되지
    않은(현재 보고 있거나 갱신 실패) 행은 None으로 내려간다.
    """
    if report_ids is not None and not report_ids:
        return []
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)

    parent, folder_names = await _load_folder_parents(db)
    reports = {r.id: r for r in (await db.execute(select(Report))).scalars().all()}

    stmt = (
        select(
            AuditLog.id,
            AuditLog.occurred_at_utc,
            AuditLog.resource_id,
            AuditLog.duration_seconds,
            User.external_id,
            User.name.label("user_name"),
            Department.name.label("dept_name"),
        )
        .select_from(AuditLog)
        .join(User, User.id == AuditLog.actor_user_id)
        .outerjoin(Department, Department.id == User.department_id)
        .where(AuditLog.action == AuditAction.REPORT_VIEW)
    )
    if report_ids is not None:
        stmt = stmt.where(AuditLog.resource_id.in_({str(i) for i in report_ids}))
    if nf is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc >= nf)
    if nt is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc <= nt)
    stmt = stmt.order_by(AuditLog.occurred_at_utc.desc()).limit(limit)

    rows = (await db.execute(stmt)).all()
    result: list[dict] = []
    for log_id, occurred, resource_id, duration, emp_no, user_name, dept_name in rows:
        try:
            rid = int(resource_id) if resource_id is not None else None
        except (TypeError, ValueError):
            rid = None
        report = reports.get(rid) if rid is not None else None
        report_name = None
        company_label = None
        if report is not None:
            report_name = report.display_name or report.report_name or report.report_id
            root = _root_folder_id(report.folder_id, parent)
            company_label = _company_label(folder_names.get(root) if root else None)
        occurred_iso = occurred.replace(tzinfo=timezone.utc).isoformat() if occurred else None
        result.append({
            "occurred_at": occurred_iso,
            "user_emp_no": emp_no,
            "user_name": user_name,
            "company": company_label,
            "department": dept_name or "(부서 없음)",
            "report_id": rid,
            "report_name": report_name or "(알 수 없음)",
            "duration_seconds": duration,
        })
    return result
