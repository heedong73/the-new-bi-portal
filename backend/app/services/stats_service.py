"""통계 집계 서비스 (T-33).

design.md / R18 참조. 별도 원장 없이 기존 테이블(audit_logs, reports,
refresh_runs, mail_jobs, export_jobs, users, departments)에 대한 집계 쿼리로 산출한다.

기간 필터(from/to)는 시간 경계가 있는 지표에 적용한다. 시간 컬럼의 tz 표현이
테이블마다 달라(audit/mail=naive UTC, refresh=tz-aware UTC) 비교 전에 정규화한다.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, case, distinct, func, or_, select, text
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
from app.services import org_directory
from app.services.org_directory import UNASSIGNED_LABEL


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


def _apply_event_report_scope(
    stmt,
    report_ids: set[int] | None,
    company_id: int | None = None,
):
    """이벤트 스냅샷 기준 회사 또는 현재 요청의 레포트 집합으로 감사 행을 제한한다."""
    if company_id is not None:
        return stmt.where(AuditLog.report_company_id == company_id)
    if report_ids is not None:
        return stmt.where(
            AuditLog.resource_id.in_({str(i) for i in report_ids} or {"__none__"})
        )
    return stmt


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
    *,
    company_id: int | None = None,
    include_system_activity: bool = True,
) -> dict:
    """기본 통계. 레포트 범위 사용자와 필터 조회에는 레포트 활동만 노출한다."""
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)
    af, at = _as_aware_utc(from_dt), _as_aware_utc(to_dt)

    def _audit_range(stmt):
        if nf is not None:
            stmt = stmt.where(AuditLog.occurred_at_utc >= nf)
        if nt is not None:
            stmt = stmt.where(AuditLog.occurred_at_utc <= nt)
        return stmt

    def _report_create_range(stmt):
        stmt = _audit_range(stmt).where(
            AuditLog.action == AuditAction.REPORT_CREATE,
            AuditLog.result == "success",
        )
        return _apply_event_report_scope(stmt, report_ids, company_id)

    # 레포트 범위 사용자와 회사/레포트 필터는 로그인·운영 작업을 섞지 않는다.
    report_metrics_only = (
        report_ids is not None
        or company_id is not None
        or not include_system_activity
    )
    if report_metrics_only:
        def _view_scope(stmt):
            stmt = _audit_range(stmt).where(AuditLog.action == AuditAction.REPORT_VIEW)
            return _apply_event_report_scope(stmt, report_ids, company_id)

        report_view_count = await _count(db, _view_scope(
            select(func.count()).select_from(AuditLog)
        ))
        unique_visitors = await _count(db, _view_scope(
            select(func.count(distinct(AuditLog.actor_user_id))).select_from(AuditLog)
        ))
        viewed_reports = await _count(db, _view_scope(
            select(func.count(distinct(AuditLog.resource_id))).select_from(AuditLog)
        ))
        new_reports = await _count(db, _report_create_range(
            select(func.count()).select_from(AuditLog)
        ))
        total_reports = (
            len(report_ids)
            if report_ids is not None
            else await _count(db, select(func.count()).select_from(Report))
        )
        return {
            "scoped": True,
            "global_reports": report_ids is None and company_id is None,
            "unique_visitors": unique_visitors,
            "total_visits": report_view_count,
            "report_view_count": report_view_count,
            "viewed_reports": viewed_reports,
            "total_reports": total_reports,
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
    new_reports = await _count(db, _report_create_range(
        select(func.count()).select_from(AuditLog)
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
    *,
    company_id: int | None = None,
    include_system_activity: bool = True,
) -> dict:
    """레포트 사용 통계. 시스템 작업은 운영자의 무필터 전역 화면에만 포함한다."""
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)
    scoped = report_ids is not None or company_id is not None or not include_system_activity

    def _audit_view_range(stmt):
        stmt = stmt.where(AuditLog.action == AuditAction.REPORT_VIEW)
        stmt = _apply_event_report_scope(stmt, report_ids, company_id)
        if nf is not None:
            stmt = stmt.where(AuditLog.occurred_at_utc >= nf)
        if nt is not None:
            stmt = stmt.where(AuditLog.occurred_at_utc <= nt)
        return stmt

    # 인기 리포트 TOP 10 (조회 수 기준) — resource_id(문자열) 그룹핑 후 이름 매핑
    top_rows = (await db.execute(_audit_view_range(
        select(
            AuditLog.resource_id,
            func.max(AuditLog.report_name_snapshot).label("report_name_snapshot"),
            func.count().label("cnt"),
        )
        .select_from(AuditLog)
        .where(AuditLog.resource_id.is_not(None))
        .group_by(AuditLog.resource_id)
        .order_by(func.count().desc())
        .limit(10)
    ))).all()
    top_reports = await _attach_report_names(db, top_rows)

    # 사용자별 조회 수 (TOP 10)
    user_rows = (await db.execute(_audit_view_range(
        select(
            AuditLog.actor_user_id,
            func.max(AuditLog.actor_name_snapshot).label("user_name_snapshot"),
            func.count().label("cnt"),
        )
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
    if report_ids is not None:
        folder_stmt = folder_stmt.where(Report.id.in_(report_ids or {-1}))
    folder_rows = (await db.execute(
        folder_stmt.group_by(ReportFolder.id, ReportFolder.name)
        .order_by(func.count(Report.id).desc())
    )).all()
    reports_by_department = [
        {"folder_id": fid, "department": name or "(미지정)", "count": int(cnt)}
        for fid, name, cnt in folder_rows
    ]

    # 부서별 조회 수: 이벤트 스냅샷 우선, 기존 NULL 행만 현재 조직 join으로 보완한다.
    department_expr = func.coalesce(AuditLog.actor_department_name, Department.name)
    dept_rows = (await db.execute(_audit_view_range(
        select(department_expr.label("department"), func.count().label("cnt"))
        .select_from(AuditLog)
        .outerjoin(User, User.id == AuditLog.actor_user_id)
        .outerjoin(Department, Department.id == User.department_id)
        .group_by(department_expr)
        .order_by(func.count().desc())
    ))).all()
    views_by_department = [
        {"department": name or "(부서 없음)", "count": int(cnt)}
        for name, cnt in dept_rows
    ]

    # 월별 실제 등록 완료 수(lifecycle 원장, 기간/스코프 반영).
    month_expr = func.to_char(_kst(AuditLog.occurred_at_utc), "YYYY-MM")
    month_stmt = select(month_expr.label("month"), func.count().label("cnt")).where(
        AuditLog.action == AuditAction.REPORT_CREATE,
        AuditLog.result == "success",
    )
    month_stmt = _apply_event_report_scope(month_stmt, report_ids, company_id)
    if nf is not None:
        month_stmt = month_stmt.where(AuditLog.occurred_at_utc >= nf)
    if nt is not None:
        month_stmt = month_stmt.where(AuditLog.occurred_at_utc <= nt)
    month_rows = (await db.execute(
        month_stmt.group_by(month_expr).order_by(month_expr)
    )).all()
    reports_by_month = [{"month": m, "count": int(c)} for m, c in month_rows]

    # 미사용 리포트 (UNUSED_REPORT_DAYS 동안 조회 이력 없는 공개 리포트)
    unused_reports = await _unused_reports(db, report_ids, company_id=company_id)

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

    # 운영자가 아닌 사용자: 부여 레포트 사용 통계만, 시스템 전역 섹션 제외
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
    """(resource_id, snapshot_name, cnt) → TOP 레포트. 현재 레포트가 없으면 snapshot 유지."""
    result: list[dict] = []
    for resource_id, snapshot_name, cnt in rows:
        report_name = snapshot_name
        try:
            rid = int(resource_id)
            report = await db.scalar(select(Report).where(Report.id == rid))
            if report is not None:
                report_name = report.display_name or report.report_name or report.report_id
        except (ValueError, TypeError):
            pass
        result.append({
            "report_id": resource_id,
            "report_name": report_name,
            "count": int(cnt),
        })
    return result


async def _attach_user_names(db: AsyncSession, rows) -> list[dict]:
    """(actor_user_id, snapshot_name, cnt) → 사용자 TOP. snapshot을 우선한다."""
    result: list[dict] = []
    for user_id, snapshot_name, cnt in rows:
        user = None
        if snapshot_name is None:
            user = await db.scalar(select(User).where(User.id == user_id))
        result.append({
            "user_id": user_id,
            "user_name": snapshot_name or (user.name if user else None),
            "count": int(cnt),
        })
    return result


async def _unused_reports(
    db: AsyncSession,
    report_ids: set[int] | None = None,
    *,
    company_id: int | None = None,
) -> list[dict]:
    """최근 조회 이력이 없는 현재 공개 리포트 목록.

    회사 필터는 감사 이벤트의 기록 시점 회사 스냅샷을 사용하고, 현재 공개
    리포트 후보는 report_ids(현재 카탈로그 범위)로 제한한다.
    """
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
        days=settings.UNUSED_REPORT_DAYS
    )
    viewed_stmt = select(AuditLog.resource_id).where(
        AuditLog.action == AuditAction.REPORT_VIEW,
        AuditLog.occurred_at_utc >= cutoff,
        AuditLog.resource_id.is_not(None),
    )
    viewed_stmt = _apply_event_report_scope(viewed_stmt, report_ids, company_id)
    viewed_rows = (await db.execute(viewed_stmt.distinct())).all()
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
    *,
    company_id: int | None = None,
) -> dict:
    """기간 필터와 무관한 상시 지표: 오늘/어제 접속(중복 미제거), 최근 접속 시각,
    미사용 레포트 수. 통계 화면 상단 기간 필터를 어떻게 바꿔도 항상 '오늘 vs 어제'
    기준을 유지한다(작성자 대시보드 KPI/인사이트용).

    report_ids 지정 시(Super_User) 그 범위로 한정. None이면 전체(운영자).
    """
    if company_id is None and report_ids is not None and not report_ids:
        return {
            "today_views": 0, "yesterday_views": 0, "pct_change": None, "is_new": False,
            "last_access": None, "unused_count": 0,
        }

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
        return _apply_event_report_scope(stmt, report_ids, company_id)

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
    last_stmt = _apply_event_report_scope(last_stmt, report_ids, company_id)
    last = await db.scalar(last_stmt)
    last_access = last.replace(tzinfo=timezone.utc).isoformat() if last else None

    unused = await _unused_reports(db, report_ids, company_id=company_id)

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
    *,
    company_id: int | None = None,
    include_system_activity: bool = True,
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
    report_metrics_only = (
        report_ids is not None
        or company_id is not None
        or not include_system_activity
    )
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
    v_stmt = _apply_event_report_scope(v_stmt, report_ids, company_id)
    v_rows = (await db.execute(_occurred_range(v_stmt).group_by(v_label))).all()
    views_by = {b: (int(v), int(u)) for b, v, u in v_rows}

    # 로그인 고유 사용자 (전역일 때만; 스코프는 조회 고유 사용자를 사용)
    login_users_by: dict[str, int] = {}
    if not report_metrics_only:
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

    # 레포트 등록 완료 lifecycle 이벤트. 표시용 신규 수는 반드시 요청 기간을 적용하고,
    # 누적 수 계산만 전체 히스토리를 사용한다(기간 밖 신규 버킷 누출 방지).
    r_label = func.to_char(_kst(AuditLog.occurred_at_utc), fmt)
    r_base = (
        select(r_label.label("bucket"), func.count().label("c"))
        .select_from(AuditLog)
        .where(
            AuditLog.action == AuditAction.REPORT_CREATE,
            AuditLog.result == "success",
        )
    )
    r_base = _apply_event_report_scope(r_base, report_ids, company_id)
    all_r_rows = (await db.execute(r_base.group_by(r_label))).all()
    all_new_by = {b: int(c) for b, c in all_r_rows}
    ranged_r_rows = (await db.execute(_occurred_range(r_base).group_by(r_label))).all()
    new_by = {b: int(c) for b, c in ranged_r_rows}

    # 표시 버킷 = 기간 내 조회/로그인/신규등록 버킷의 합집합.
    buckets = sorted(set(views_by) | set(login_users_by) | set(new_by))

    series = []
    for b in buckets:
        views, vusers = views_by.get(b, (0, 0))
        users = vusers if report_metrics_only else login_users_by.get(b, 0)
        new_count = new_by.get(b, 0)
        cumulative = sum(c for lbl, c in all_new_by.items() if lbl <= b)
        series.append({
            "period": b,
            "unique_users": users,
            "views": views,
            "new_reports": new_count,
            "total_reports": cumulative,
        })
    return {"granularity": granularity, "scoped": report_metrics_only, "series": series}


async def get_report_detail(
    db: AsyncSession,
    from_dt: datetime | None,
    to_dt: datetime | None,
    report_ids: set[int] | None = None,
    *,
    company_id: int | None = None,
) -> list[dict]:
    """레포트별 조회 상세 — 부서별 조회수/고유 사용자/최근 접속.

    report_ids 지정 시 그 집합으로 한정(단일 레포트 또는 계열사 전체). None이면
    전체 레포트 대상(운영자). 조회자(actor)의 부서 기준으로 집계한다.
    """
    if company_id is None and report_ids is not None and not report_ids:
        return []
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)
    org_map = await org_directory.department_org_map(db)

    # 부서명이 코드→한글명으로 바뀐 이력이 있어도 한 행으로 합치도록 부서 ID로 묶는다.
    department_id_expr = func.coalesce(AuditLog.actor_department_id, User.department_id)
    department_name_expr = func.max(
        func.coalesce(AuditLog.actor_department_name, Department.name)
    )
    stmt = (
        select(
            department_id_expr.label("dept_id"),
            department_name_expr.label("dept"),
            func.count().label("views"),
            func.count(distinct(AuditLog.actor_user_id)).label("users"),
            func.max(AuditLog.occurred_at_utc).label("last"),
        )
        .select_from(AuditLog)
        .outerjoin(User, User.id == AuditLog.actor_user_id)
        .outerjoin(Department, Department.id == User.department_id)
        .where(AuditLog.action == AuditAction.REPORT_VIEW)
    )
    stmt = _apply_event_report_scope(stmt, report_ids, company_id)
    if nf is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc >= nf)
    if nt is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc <= nt)
    stmt = stmt.group_by(department_id_expr).order_by(func.count().desc())

    rows = (await db.execute(stmt)).all()
    result: list[dict] = []
    for dept_id, dept, views, users, last in rows:
        org = org_map.get(int(dept_id)) if dept_id is not None else None
        # naive UTC → tz-aware ISO(UTC). 프런트가 로컬로 표시.
        last_iso = last.replace(tzinfo=timezone.utc).isoformat() if last else None
        result.append({
            "department_id": int(dept_id) if dept_id is not None else None,
            "department": org.name if org is not None else (dept or UNASSIGNED_LABEL),
            "company": org.company if org is not None else None,
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
    company_id: int | None = None,
    department_id: int | None = None,
    unassigned_department: bool = False,
    user_id: int | None = None,
) -> list[dict]:
    """시간대별(0~23시, KST) 레포트 조회 수 / 고유 사용자 수.

    상세 조회 탭에서 특정 부서 또는 사용자를 선택했을 때, 그 부서/사용자로
    한정한 시간대별 추이를 보기 위한 드릴다운용(usage.hourly는 필터 없는 전체
    기준). 부서 필터는 이름이 아닌 부서 ID로 걸어, 코드→한글명 변경 이력이 있는
    부서도 같은 범위로 묶인다. department_id/user_id는 상호 배타적으로 쓰되 동시
    지정도 AND로 허용한다.
    """
    if company_id is None and report_ids is not None and not report_ids:
        return [{"hour": h, "views": 0, "users": 0} for h in range(24)]
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)

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
    if department_id is not None or unassigned_department:
        department_id_expr = func.coalesce(
            AuditLog.actor_department_id, User.department_id,
        )
        stmt = stmt.outerjoin(User, User.id == AuditLog.actor_user_id).where(
            department_id_expr.is_(None)
            if unassigned_department else department_id_expr == department_id
        )
    if user_id is not None:
        stmt = stmt.where(AuditLog.actor_user_id == user_id)
    stmt = _apply_event_report_scope(stmt, report_ids, company_id)
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
    *,
    company_id: int | None = None,
) -> list[dict]:
    """레포트별 조회 상세 — 사용자별 조회수/부서/최근 접속.

    부서별 집계(get_report_detail)와 짝을 이루는 사용자 단위 상세. report_ids
    지정 시 그 집합으로 한정(단일 레포트 또는 계열사 전체). None이면 전체 대상.
    """
    if company_id is None and report_ids is not None and not report_ids:
        return []
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)
    org_map = await org_directory.department_org_map(db)

    user_name_expr = func.coalesce(AuditLog.actor_name_snapshot, User.name)
    department_expr = func.coalesce(AuditLog.actor_department_name, Department.name)
    department_id_expr = func.coalesce(AuditLog.actor_department_id, User.department_id)
    stmt = (
        select(
            AuditLog.actor_user_id.label("user_id"),
            user_name_expr.label("user_name"),
            department_expr.label("dept"),
            department_id_expr.label("dept_id"),
            func.count().label("views"),
            func.max(AuditLog.occurred_at_utc).label("last"),
        )
        .select_from(AuditLog)
        .outerjoin(User, User.id == AuditLog.actor_user_id)
        .outerjoin(Department, Department.id == User.department_id)
        .where(
            AuditLog.action == AuditAction.REPORT_VIEW,
            AuditLog.actor_user_id.is_not(None),
        )
    )
    stmt = _apply_event_report_scope(stmt, report_ids, company_id)
    if nf is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc >= nf)
    if nt is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc <= nt)
    stmt = stmt.group_by(
        AuditLog.actor_user_id, user_name_expr, department_expr, department_id_expr,
    ).order_by(func.count().desc())

    rows = (await db.execute(stmt)).all()
    result: list[dict] = []
    for user_id, user_name, dept, dept_id, views, last in rows:
        org = org_map.get(int(dept_id)) if dept_id is not None else None
        last_iso = last.replace(tzinfo=timezone.utc).isoformat() if last else None
        result.append({
            "user_id": user_id,
            "user_name": user_name or f"#{user_id}",
            "department": org.name if org is not None else (dept or UNASSIGNED_LABEL),
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
    company_id: int | None = None,
    limit: int = 50_000,
) -> list[dict]:
    """레포트 조회(report_view) 로우 이벤트 — 일시·사용자·계열사·부서·레포트·체류시간.

    한 행 = Power BI 첫 rendered 이벤트로 확정된 한 번의 조회 세션. 작성자/운영자가
    누가, 언제, 얼마나 봤는지"를 엑셀에서 자유롭게 피벗/필터링할 수 있도록 사전
    집계 없이 원본 단위로 내려준다. report_ids 지정 시 그 범위로 한정(None=전체).

    duration_seconds는 프런트가 탭 이탈 시점에 갱신하는 근사치이며, 아직 갱신되지
    않은(현재 보고 있거나 갱신 실패) 행은 None으로 내려간다.
    """
    if company_id is None and report_ids is not None and not report_ids:
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
            func.coalesce(AuditLog.actor_emp_no_snapshot, User.external_id),
            func.coalesce(
                AuditLog.actor_name_snapshot, User.name, AuditLog.actor_label,
            ).label("user_name"),
            func.coalesce(AuditLog.actor_department_name, Department.name).label("dept_name"),
            AuditLog.report_name_snapshot,
            AuditLog.report_company_name,
        )
        .select_from(AuditLog)
        .outerjoin(User, User.id == AuditLog.actor_user_id)
        .outerjoin(Department, Department.id == User.department_id)
        .where(AuditLog.action == AuditAction.REPORT_VIEW)
    )
    stmt = _apply_event_report_scope(stmt, report_ids, company_id)
    if nf is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc >= nf)
    if nt is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc <= nt)
    stmt = stmt.order_by(AuditLog.occurred_at_utc.desc()).limit(limit)

    rows = (await db.execute(stmt)).all()
    result: list[dict] = []
    for (
        log_id, occurred, resource_id, duration, emp_no, user_name, dept_name,
        report_name_snapshot, company_name_snapshot,
    ) in rows:
        try:
            rid = int(resource_id) if resource_id is not None else None
        except (TypeError, ValueError):
            rid = None
        report = reports.get(rid) if rid is not None else None
        report_name = report_name_snapshot
        company_label = _company_label(company_name_snapshot) if company_name_snapshot else None
        if report is not None:
            if report_name is None:
                report_name = report.display_name or report.report_name or report.report_id
            if company_label is None:
                root = _root_folder_id(report.folder_id, parent)
                company_label = _company_label(folder_names.get(root) if root else None)
        occurred_iso = occurred.replace(tzinfo=timezone.utc).isoformat() if occurred else None
        result.append({
            "occurred_at": occurred_iso,
            "user_emp_no": emp_no,
            "user_name": user_name,
            "company": company_label or "(미지정)",
            "department": dept_name or "(부서 없음)",
            "report_id": rid,
            "report_name": report_name or "(알 수 없음)",
            "duration_seconds": duration,
        })
    return result


# ── 역할별 활동 분석(P1) / 참여도 인사이트(P2) ─────────────────────────────
ENGAGED_DURATION_SECONDS = 30
REPEAT_SESSION_COUNT = 2
DECLINE_RATIO = 0.5


def _activity_scope_condition(
    report_ids: set[int] | None,
    *,
    company_id: int | None,
    include_logins: bool,
):
    """통계 스코프에 포함되는 실제 활동 이벤트 조건."""
    report_activity = AuditLog.action.in_([
        AuditAction.REPORT_VIEW,
        AuditAction.EXPORT_DOWNLOAD,
    ])
    if company_id is not None:
        report_activity = and_(
            report_activity,
            AuditLog.report_company_id == company_id,
        )
    elif report_ids is not None:
        report_activity = and_(
            report_activity,
            AuditLog.resource_id.in_({str(i) for i in report_ids} or {"__none__"}),
        )
    if include_logins:
        return or_(
            report_activity,
            and_(AuditLog.action == AuditAction.LOGIN, AuditLog.result == "success"),
        )
    return report_activity


def _apply_audit_period(stmt, from_dt: datetime | None, to_dt: datetime | None):
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)
    if nf is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc >= nf)
    if nt is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc <= nt)
    return stmt


def _comparison_bounds(
    from_dt: datetime | None,
    to_dt: datetime | None,
) -> tuple[datetime, datetime, datetime, datetime]:
    """현재 기간과 바로 앞 동일 길이 기간(naive UTC)을 반환. 미지정 시 최근 30일."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    current_to = _as_naive_utc(to_dt) or now
    current_from = _as_naive_utc(from_dt) or (current_to - timedelta(days=30))
    if current_from > current_to:
        current_from, current_to = current_to, current_from
    span = max(current_to - current_from, timedelta(seconds=1))
    previous_to = current_from - timedelta(microseconds=1)
    previous_from = previous_to - span
    return current_from, current_to, previous_from, previous_to


def _utc_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _pct_change(current: int | float, previous: int | float) -> float | None:
    if previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


async def get_team_activity(
    db: AsyncSession,
    from_dt: datetime | None,
    to_dt: datetime | None,
    report_ids: set[int] | None = None,
    *,
    company_id: int | None = None,
    include_system_activity: bool = True,
) -> list[dict]:
    """팀별 조회·다운로드·로그인·유효 참여와 활성 사용자 현황."""
    show_all_teams = report_ids is None and company_id is None
    include_logins = include_system_activity and show_all_teams
    org_map = await org_directory.department_org_map(db)
    department_id = func.coalesce(AuditLog.actor_department_id, User.department_id)
    # 조직 맵에 없는 과거 부서만 스냅샷 이름으로 후퇴한다.
    department_name = func.max(
        func.coalesce(AuditLog.actor_department_name, Department.name)
    )
    view_filter = AuditLog.action == AuditAction.REPORT_VIEW
    download_filter = AuditLog.action == AuditAction.EXPORT_DOWNLOAD
    login_filter = and_(AuditLog.action == AuditAction.LOGIN, AuditLog.result == "success")

    stmt = (
        select(
            department_id.label("department_id"),
            department_name.label("department"),
            func.count().filter(view_filter).label("report_views"),
            func.count(distinct(AuditLog.actor_user_id)).filter(view_filter).label("active_users"),
            func.count().filter(download_filter).label("downloads"),
            func.count().filter(login_filter).label("logins"),
            func.count().filter(and_(
                view_filter,
                func.coalesce(AuditLog.duration_seconds, 0) >= ENGAGED_DURATION_SECONDS,
            )).label("engaged_views"),
            func.max(AuditLog.occurred_at_utc).label("last_activity"),
        )
        .select_from(AuditLog)
        .outerjoin(User, User.id == AuditLog.actor_user_id)
        .outerjoin(Department, Department.id == User.department_id)
        .where(
            AuditLog.result == "success",
            _activity_scope_condition(
                report_ids,
                company_id=company_id,
                include_logins=include_logins,
            ),
        )
        .group_by(department_id)
    )
    rows = (await db.execute(_apply_audit_period(stmt, from_dt, to_dt))).all()

    # 현재 활성 등록 사용자 수를 분모로 사용한다. 활동이 0인 팀도 전역 화면에는 표시한다.
    eligible_rows = (await db.execute(
        select(
            Department.id,
            Department.name,
            func.count(User.id).filter(User.is_active.is_(True)),
        )
        .select_from(Department)
        .outerjoin(User, User.department_id == Department.id)
        .group_by(Department.id, Department.name)
    )).all()
    eligible_by_department = {
        dept_id: int(eligible) for dept_id, _name, eligible in eligible_rows
    }
    teams: dict[int | None, dict] = {}
    if show_all_teams:
        for dept_id, name, eligible in eligible_rows:
            teams[dept_id] = {
                "department_id": dept_id,
                "department": name,
                "eligible_users": int(eligible),
                "active_users": 0,
                "report_views": 0,
                "downloads": 0,
                "logins": 0 if include_logins else None,
                "engaged_views": 0,
                "adoption_rate": 0.0,
                "last_activity": None,
            }

    for dept_id, name, views, active, downloads, logins, engaged, last in rows:
        item = teams.setdefault(dept_id, {
            "department_id": dept_id,
            "department": name,
            "eligible_users": eligible_by_department.get(dept_id, 0),
        })
        item.update({
            "department": name or item.get("department"),
            "active_users": int(active or 0),
            "report_views": int(views or 0),
            "downloads": int(downloads or 0),
            "logins": int(logins or 0) if include_logins else None,
            "engaged_views": int(engaged or 0),
            "last_activity": _utc_iso(last),
        })
        eligible = int(item.get("eligible_users") or 0)
        item["adoption_rate"] = round(int(active or 0) / eligible * 100, 1) if eligible else None

    # 부서 코드로 남은 이름을 인사 부서명으로 바꾸고 계열사·본부를 채운다.
    for dept_id, item in teams.items():
        org = org_map.get(dept_id) if dept_id is not None else None
        item["department"] = (
            org.name if org is not None else (item.get("department") or UNASSIGNED_LABEL)
        )
        item["company"] = org.company if org is not None else None
        item["division"] = org.division if org is not None else None
        item["org_path"] = org.org_path if org is not None else None

    result = list(teams.values())
    result.sort(
        key=lambda row: (
            -(row.get("report_views") or 0),
            -(row.get("downloads") or 0),
            row.get("department") or "",
        )
    )
    return result


async def get_user_activity(
    db: AsyncSession,
    from_dt: datetime | None,
    to_dt: datetime | None,
    report_ids: set[int] | None = None,
    *,
    company_id: int | None = None,
    include_system_activity: bool = True,
    limit: int = 500,
) -> list[dict]:
    """사용자별 조회·다운로드·로그인·체류·레포트 도달 현황."""
    show_all_users = report_ids is None and company_id is None
    include_logins = include_system_activity and show_all_users
    view_filter = AuditLog.action == AuditAction.REPORT_VIEW
    download_filter = AuditLog.action == AuditAction.EXPORT_DOWNLOAD
    login_filter = and_(AuditLog.action == AuditAction.LOGIN, AuditLog.result == "success")
    stmt = (
        select(
            AuditLog.actor_user_id,
            func.max(AuditLog.actor_emp_no_snapshot),
            func.max(AuditLog.actor_name_snapshot),
            func.max(AuditLog.actor_department_name),
            func.max(AuditLog.actor_department_id),
            func.count().filter(view_filter).label("report_views"),
            func.count(distinct(AuditLog.resource_id)).filter(view_filter).label("reports_viewed"),
            func.count().filter(download_filter).label("downloads"),
            func.count().filter(login_filter).label("logins"),
            func.count().filter(and_(
                view_filter,
                func.coalesce(AuditLog.duration_seconds, 0) >= ENGAGED_DURATION_SECONDS,
            )).label("engaged_views"),
            func.coalesce(func.sum(case(
                (view_filter, func.coalesce(AuditLog.duration_seconds, 0)),
                else_=0,
            )), 0).label("duration_seconds"),
            func.max(AuditLog.occurred_at_utc).label("last_activity"),
        )
        .select_from(AuditLog)
        .where(
            AuditLog.actor_user_id.is_not(None),
            AuditLog.result == "success",
            _activity_scope_condition(
                report_ids,
                company_id=company_id,
                include_logins=include_logins,
            ),
        )
        .group_by(AuditLog.actor_user_id)
    )
    org_map = await org_directory.department_org_map(db)

    def _org_labels(department_id, snapshot_name) -> tuple[str, str | None]:
        """(표시 부서명, 계열사). 코드로 남은 스냅샷을 인사 부서명으로 바꾼다."""
        org = org_map.get(int(department_id)) if department_id is not None else None
        if org is not None:
            return org.name, org.company
        return snapshot_name or UNASSIGNED_LABEL, None

    event_rows = (await db.execute(_apply_audit_period(stmt, from_dt, to_dt))).all()
    activity: dict[int, dict] = {}
    for (
        user_id, emp_no, name, department, department_id, views, reports_viewed,
        downloads, logins, engaged, duration, last,
    ) in event_rows:
        department_name, company = _org_labels(department_id, department)
        activity[int(user_id)] = {
            "user_id": int(user_id),
            "emp_no": emp_no,
            "user_name": name,
            "department": department_name,
            "company": company,
            "is_active": True,
            "report_views": int(views or 0),
            "reports_viewed": int(reports_viewed or 0),
            "downloads": int(downloads or 0),
            "login_count": int(logins or 0) if include_logins else None,
            "engaged_views": int(engaged or 0),
            "duration_seconds": int(duration or 0),
            "last_activity": _utc_iso(last),
        }

    user_stmt = (
        select(User, Department.name)
        .outerjoin(Department, Department.id == User.department_id)
        .order_by(User.id)
    )
    current_users = (await db.execute(user_stmt)).all()
    for user, department in current_users:
        if not show_all_users and user.id not in activity:
            continue
        item = activity.setdefault(user.id, {
            "user_id": user.id,
            "report_views": 0,
            "reports_viewed": 0,
            "downloads": 0,
            "login_count": 0 if include_logins else None,
            "engaged_views": 0,
            "duration_seconds": 0,
            "last_activity": None,
        })
        department_name, company = _org_labels(user.department_id, department)
        item.update({
            "emp_no": user.external_id,
            "user_name": user.name,
            "department": department_name,
            "company": company,
            "is_active": user.is_active,
        })

    result = list(activity.values())
    result.sort(key=lambda row: (
        -(row["report_views"] + row["downloads"] + (row.get("login_count") or 0)),
        row.get("user_name") or "",
    ))
    return result[:max(1, min(limit, 2000))]


async def get_report_performance(
    db: AsyncSession,
    from_dt: datetime | None,
    to_dt: datetime | None,
    report_ids: set[int] | None = None,
    *,
    company_id: int | None = None,
) -> list[dict]:
    """레포트별 조회·다운로드·유효체류·재방문·직전기간 비교.

    회사 단독 필터에서는 현재 회사 소속 레포트와 해당 회사 snapshot을 가진 과거
    이벤트 레포트를 합쳐, 이동·삭제된 레포트의 당시 활동도 다른 회사로 재귀속하지
    않는다. report_id 범위는 선택한 현재 레포트의 전체 이력을 유지한다.
    """
    current_from, current_to, previous_from, previous_to = _comparison_bounds(
        from_dt, to_dt,
    )

    catalog_scope = report_ids
    if company_id is not None and catalog_scope is None:
        catalog_scope = await company_report_ids(db, company_id)
    report_stmt = select(Report)
    if catalog_scope is not None:
        report_stmt = report_stmt.where(Report.id.in_(catalog_scope or {-1}))
    catalog_reports = (await db.execute(report_stmt)).scalars().all()
    report_map = {report.id: report for report in catalog_reports}

    if company_id is not None:
        event_scope = AuditLog.report_company_id == company_id
    elif report_ids is not None:
        event_scope = AuditLog.resource_id.in_(
            {str(report_id) for report_id in report_ids} or {"__none__"}
        )
    else:
        event_scope = AuditLog.id.is_not(None)

    view_filter = AuditLog.action == AuditAction.REPORT_VIEW
    download_filter = AuditLog.action == AuditAction.EXPORT_DOWNLOAD
    activity_actions = [AuditAction.REPORT_VIEW, AuditAction.EXPORT_DOWNLOAD]

    # 회사 화면에서는 event snapshot에 존재하는 이동·삭제 레포트도 행 후보로 유지한다.
    metadata_rows = (await db.execute(
        select(
            AuditLog.resource_id,
            func.max(AuditLog.report_name_snapshot),
            func.max(AuditLog.report_company_name),
            func.max(AuditLog.report_owner_user_id),
            func.max(AuditLog.report_owner_label),
        )
        .where(
            AuditLog.result == "success",
            AuditLog.resource_id.is_not(None),
            AuditLog.action.in_(activity_actions),
            event_scope,
        )
        .group_by(AuditLog.resource_id)
    )).all()
    event_metadata: dict[int, dict] = {}
    for resource_id, report_name, company_name, owner_user_id, owner_label in metadata_rows:
        try:
            parsed_id = int(resource_id)
        except (TypeError, ValueError):
            continue
        event_metadata[parsed_id] = {
            "report_name": report_name,
            "company_name": company_name,
            "owner_user_id": owner_user_id,
            "owner_label": owner_label,
        }

    candidate_ids = set(report_map)
    if company_id is not None:
        candidate_ids.update(event_metadata)
    if not candidate_ids:
        return []

    missing_ids = candidate_ids - set(report_map)
    if missing_ids:
        moved_reports = (await db.execute(
            select(Report).where(Report.id.in_(missing_ids))
        )).scalars().all()
        report_map.update({report.id: report for report in moved_reports})

    aggregate_stmt = (
        select(
            AuditLog.resource_id,
            func.count().filter(view_filter).label("views"),
            func.count(distinct(AuditLog.actor_user_id)).filter(view_filter).label("unique_viewers"),
            func.count().filter(download_filter).label("downloads"),
            func.count().filter(and_(
                view_filter,
                func.coalesce(AuditLog.duration_seconds, 0) >= ENGAGED_DURATION_SECONDS,
            )).label("engaged_views"),
            func.avg(AuditLog.duration_seconds).filter(view_filter).label("avg_duration"),
        )
        .select_from(AuditLog)
        .where(
            AuditLog.result == "success",
            event_scope,
            AuditLog.action.in_(activity_actions),
        )
        .group_by(AuditLog.resource_id)
    )
    current_rows = (await db.execute(
        _apply_audit_period(aggregate_stmt, current_from, current_to)
    )).all()
    current: dict[int, dict] = {}
    for resource_id, views, users, downloads, engaged, avg_duration in current_rows:
        try:
            parsed_id = int(resource_id)
        except (TypeError, ValueError):
            continue
        current[parsed_id] = {
            "views": int(views or 0),
            "unique_viewers": int(users or 0),
            "downloads": int(downloads or 0),
            "engaged_views": int(engaged or 0),
            "avg_duration_seconds": round(float(avg_duration or 0), 1),
        }

    previous_rows = (await db.execute(
        select(AuditLog.resource_id, func.count())
        .where(
            AuditLog.action == AuditAction.REPORT_VIEW,
            AuditLog.result == "success",
            event_scope,
            AuditLog.occurred_at_utc >= previous_from,
            AuditLog.occurred_at_utc <= previous_to,
        )
        .group_by(AuditLog.resource_id)
    )).all()
    previous: dict[int, int] = {}
    for resource_id, count in previous_rows:
        try:
            previous[int(resource_id)] = int(count)
        except (TypeError, ValueError):
            continue

    repeat_stmt = (
        select(
            AuditLog.resource_id,
            AuditLog.actor_user_id,
            func.count().label("sessions"),
        )
        .where(
            AuditLog.action == AuditAction.REPORT_VIEW,
            AuditLog.result == "success",
            AuditLog.actor_user_id.is_not(None),
            event_scope,
        )
        .group_by(AuditLog.resource_id, AuditLog.actor_user_id)
        .having(func.count() >= REPEAT_SESSION_COUNT)
    )
    repeat_subquery = _apply_audit_period(
        repeat_stmt, current_from, current_to,
    ).subquery()
    repeat_rows = (await db.execute(
        select(repeat_subquery.c.resource_id, func.count())
        .group_by(repeat_subquery.c.resource_id)
    )).all()
    repeat_viewers: dict[int, int] = {}
    for resource_id, count in repeat_rows:
        try:
            repeat_viewers[int(resource_id)] = int(count)
        except (TypeError, ValueError):
            continue

    all_time_rows = (await db.execute(
        select(AuditLog.resource_id, func.max(AuditLog.occurred_at_utc))
        .where(
            AuditLog.action == AuditAction.REPORT_VIEW,
            AuditLog.result == "success",
            event_scope,
        )
        .group_by(AuditLog.resource_id)
    )).all()
    all_time_last: dict[int, datetime] = {}
    for resource_id, last_viewed in all_time_rows:
        try:
            all_time_last[int(resource_id)] = last_viewed
        except (TypeError, ValueError):
            continue

    active_users = await _count(
        db, select(func.count()).select_from(User).where(User.is_active.is_(True))
    )
    parent, folder_names = await _load_folder_parents(db)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    result: list[dict] = []
    for report_id in candidate_ids:
        report = report_map.get(report_id)
        snapshot = event_metadata.get(report_id, {})
        metrics = current.get(report_id, {})
        views = int(metrics.get("views", 0))
        unique_viewers = int(metrics.get("unique_viewers", 0))
        engaged = int(metrics.get("engaged_views", 0))
        prior = int(previous.get(report_id, 0))
        last_viewed = all_time_last.get(report_id)
        days_since = (now - last_viewed).days if last_viewed is not None else None

        current_name = None
        current_company_name = None
        current_owner_id = None
        current_owner_label = None
        is_published = False
        if report is not None:
            current_name = report.display_name or report.report_name or report.report_id
            root = _root_folder_id(report.folder_id, parent)
            current_company_name = folder_names.get(root) if root else None
            current_owner_id = report.created_by_user_id
            current_owner_label = report.created_by_label or report.author_label
            is_published = report.is_published

        prefer_snapshot = company_id is not None
        report_name = (
            snapshot.get("report_name") or current_name
            if prefer_snapshot else current_name or snapshot.get("report_name")
        )
        company_name = (
            snapshot.get("company_name") or current_company_name
            if prefer_snapshot else current_company_name or snapshot.get("company_name")
        )
        owner_user_id = (
            snapshot.get("owner_user_id")
            if prefer_snapshot and snapshot.get("owner_user_id") is not None
            else current_owner_id
        )
        owner_label = (
            snapshot.get("owner_label") or current_owner_label
            if prefer_snapshot else current_owner_label or snapshot.get("owner_label")
        )

        result.append({
            "report_id": report_id,
            "report_name": report_name or f"#{report_id}",
            "company": _company_label(company_name),
            "owner_user_id": owner_user_id,
            "owner_label": owner_label,
            "is_published": is_published,
            "views": views,
            "unique_viewers": unique_viewers,
            "downloads": int(metrics.get("downloads", 0)),
            "engaged_views": engaged,
            "engaged_rate": round(engaged / views * 100, 1) if views else 0.0,
            "repeat_viewers": repeat_viewers.get(report_id, 0),
            "avg_duration_seconds": metrics.get("avg_duration_seconds", 0.0),
            "reach_rate": round(unique_viewers / active_users * 100, 1) if active_users else None,
            "previous_views": prior,
            "views_change_pct": _pct_change(views, prior),
            "declining": prior >= 3 and views <= prior * DECLINE_RATIO,
            "last_viewed_at": _utc_iso(last_viewed),
            "days_since_last_view": days_since,
        })
    result.sort(key=lambda row: (-row["views"], row["report_name"]))
    return result


async def get_lifecycle_activity(
    db: AsyncSession,
    from_dt: datetime | None,
    to_dt: datetime | None,
    report_ids: set[int] | None = None,
    *,
    company_id: int | None = None,
    owner_user_id: int | None = None,
    limit: int = 200,
    offset: int = 0,
    action: str | None = None,
) -> dict:
    """감사 원장 기준 레포트 생성·수정·삭제 요약과 이벤트 목록.

    요약은 항상 기간 전체 집계이고, 이벤트는 최신순 페이지 단위로 내려준다.
    ``action``을 주면 그 구분만 조회해 화면 카드 필터가 기간 전체를 훑을 수 있다.
    ``total``은 현재 필터에 해당하는 기간 전체 건수이므로 "더 보기" 종료 판단에 쓴다.
    """
    all_actions = [
        AuditAction.REPORT_CREATE,
        AuditAction.REPORT_UPDATE,
        AuditAction.REPORT_DELETE,
    ]
    # 요약은 세 구분 모두 필요하고, 목록만 선택 구분으로 좁힌다. 알 수 없는 값은
    # 필터 없음으로 되돌려 잘못된 파라미터가 빈 목록으로 오해되지 않게 한다.
    normalized_action = action if action in {a.value for a in all_actions} else None
    actions = (
        [a for a in all_actions if a.value == normalized_action]
        if normalized_action else list(all_actions)
    )
    scope_condition = None
    if company_id is not None:
        scope_condition = AuditLog.report_company_id == company_id
    elif report_ids is not None:
        current_scope = AuditLog.resource_id.in_({str(i) for i in report_ids} or {"__none__"})
        scope_condition = (
            or_(current_scope, AuditLog.report_owner_user_id == owner_user_id)
            if owner_user_id is not None else current_scope
        )

    base = select(AuditLog).where(
        AuditLog.action.in_(actions),
        AuditLog.result == "success",
    )
    count_stmt = (
        select(AuditLog.action, func.count())
        .where(AuditLog.action.in_(all_actions), AuditLog.result == "success")
        .group_by(AuditLog.action)
    )
    if scope_condition is not None:
        base = base.where(scope_condition)
        count_stmt = count_stmt.where(scope_condition)
    base = _apply_audit_period(base, from_dt, to_dt)
    count_stmt = _apply_audit_period(count_stmt, from_dt, to_dt)

    counts = {str(row_action): int(count) for row_action, count in (await db.execute(count_stmt)).all()}
    page_size = max(1, min(limit, 1000))
    page_offset = max(0, offset)
    logs = (await db.execute(
        base.order_by(AuditLog.occurred_at_utc.desc(), AuditLog.id.desc())
        .offset(page_offset)
        .limit(page_size)
    )).scalars().all()
    report_ids_to_load: set[int] = set()
    for log in logs:
        try:
            if log.resource_id is not None:
                report_ids_to_load.add(int(log.resource_id))
        except (TypeError, ValueError):
            pass
    report_map = {
        report.id: report for report in (await db.execute(
            select(Report).where(Report.id.in_(report_ids_to_load or {-1}))
        )).scalars().all()
    }

    events = []
    for log in logs:
        try:
            report_id = int(log.resource_id) if log.resource_id is not None else None
        except (TypeError, ValueError):
            report_id = None
        report = report_map.get(report_id) if report_id is not None else None
        events.append({
            "event_id": log.id,
            "occurred_at": _utc_iso(log.occurred_at_utc),
            "action": log.action,
            "report_id": report_id,
            "report_name": log.report_name_snapshot or (
                (report.display_name or report.report_name or report.report_id) if report else "(삭제된 레포트)"
            ),
            "company": _company_label(log.report_company_name),
            "owner_label": log.report_owner_label,
            "actor_name": log.actor_name_snapshot or log.actor_label,
        })
    summary = {
        "created": counts.get(AuditAction.REPORT_CREATE.value, 0),
        "updated": counts.get(AuditAction.REPORT_UPDATE.value, 0),
        "deleted": counts.get(AuditAction.REPORT_DELETE.value, 0),
    }
    # 요약이 이미 기간 전체 집계이므로 별도 count 질의 없이 총 건수를 얻는다.
    total = sum(counts.get(a.value, 0) for a in actions)
    return {
        "summary": summary,
        "events": events,
        "total": total,
        "limit": page_size,
        "offset": page_offset,
        "action": normalized_action,
    }


async def _period_activity_metrics(
    db: AsyncSession,
    start: datetime,
    end: datetime,
    report_ids: set[int] | None,
    *,
    company_id: int | None,
    include_system_activity: bool,
) -> dict:
    include_logins = (
        include_system_activity
        and report_ids is None
        and company_id is None
    )
    view_filter = AuditLog.action == AuditAction.REPORT_VIEW
    download_filter = AuditLog.action == AuditAction.EXPORT_DOWNLOAD
    login_filter = and_(AuditLog.action == AuditAction.LOGIN, AuditLog.result == "success")
    stmt = select(
        func.count().filter(view_filter),
        func.count(distinct(AuditLog.actor_user_id)).filter(view_filter),
        func.count().filter(download_filter),
        func.count().filter(and_(
            view_filter,
            func.coalesce(AuditLog.duration_seconds, 0) >= ENGAGED_DURATION_SECONDS,
        )),
        func.count().filter(login_filter),
        func.count(distinct(AuditLog.actor_user_id)).filter(login_filter),
    ).where(
        AuditLog.result == "success",
        AuditLog.occurred_at_utc >= start,
        AuditLog.occurred_at_utc <= end,
        _activity_scope_condition(
            report_ids,
            company_id=company_id,
            include_logins=include_logins,
        ),
    )
    views, viewers, downloads, engaged, logins, login_users = (
        await db.execute(stmt)
    ).one()

    repeat_stmt = (
        select(AuditLog.actor_user_id, func.count().label("sessions"))
        .where(
            AuditLog.action == AuditAction.REPORT_VIEW,
            AuditLog.result == "success",
            AuditLog.actor_user_id.is_not(None),
            AuditLog.occurred_at_utc >= start,
            AuditLog.occurred_at_utc <= end,
        )
        .group_by(AuditLog.actor_user_id)
        .having(func.count() >= REPEAT_SESSION_COUNT)
    )
    if company_id is not None:
        repeat_stmt = repeat_stmt.where(AuditLog.report_company_id == company_id)
    elif report_ids is not None:
        repeat_stmt = repeat_stmt.where(
            AuditLog.resource_id.in_({str(i) for i in report_ids} or {"__none__"})
        )
    repeat_viewers = await _count(
        db, select(func.count()).select_from(repeat_stmt.subquery())
    )
    return {
        "views": int(views or 0),
        "unique_viewers": int(viewers or 0),
        "downloads": int(downloads or 0),
        "engaged_views": int(engaged or 0),
        "repeat_viewers": repeat_viewers,
        "login_count": int(logins or 0) if include_logins else None,
        "unique_login_users": int(login_users or 0) if include_logins else None,
    }


async def get_adoption_insights(
    db: AsyncSession,
    from_dt: datetime | None,
    to_dt: datetime | None,
    report_ids: set[int] | None = None,
    *,
    company_id: int | None = None,
    include_system_activity: bool = True,
) -> dict:
    """유효 체류·재방문·도달·직전 동일 기간 비교·미사용/급감 인사이트."""
    current_from, current_to, previous_from, previous_to = _comparison_bounds(from_dt, to_dt)
    current = await _period_activity_metrics(
        db,
        current_from,
        current_to,
        report_ids,
        company_id=company_id,
        include_system_activity=include_system_activity,
    )
    previous = await _period_activity_metrics(
        db,
        previous_from,
        previous_to,
        report_ids,
        company_id=company_id,
        include_system_activity=include_system_activity,
    )
    views = current["views"]
    viewers = current["unique_viewers"]
    current["engaged_rate"] = round(current["engaged_views"] / views * 100, 1) if views else 0.0
    current["repeat_rate"] = round(current["repeat_viewers"] / viewers * 100, 1) if viewers else 0.0

    performance = await get_report_performance(
        db,
        current_from,
        current_to,
        report_ids,
        company_id=company_id,
    )
    inactive = [
        row for row in performance
        if row["days_since_last_view"] is None
        or row["days_since_last_view"] >= settings.UNUSED_REPORT_DAYS
    ]
    declining = [row for row in performance if row["declining"]]

    changes = {
        key: _pct_change(current[key], previous[key])
        for key in ("views", "unique_viewers", "downloads", "engaged_views")
    }
    if include_system_activity and report_ids is None and company_id is None:
        changes["login_count"] = _pct_change(
            current["login_count"] or 0, previous["login_count"] or 0,
        )

    return {
        "period": {
            "current_from": _utc_iso(current_from),
            "current_to": _utc_iso(current_to),
            "previous_from": _utc_iso(previous_from),
            "previous_to": _utc_iso(previous_to),
        },
        "current": current,
        "previous": previous,
        "changes_pct": changes,
        "inactive_cutoff_days": settings.UNUSED_REPORT_DAYS,
        "inactive_reports": inactive[:20],
        "declining_reports": declining[:20],
    }
