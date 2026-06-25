"""통계 집계 서비스 (T-33).

design.md / R18 참조. 별도 원장 없이 기존 테이블(audit_logs, reports,
refresh_runs, mail_jobs, export_jobs, users, departments)에 대한 집계 쿼리로 산출한다.

기간 필터(from/to)는 시간 경계가 있는 지표에 적용한다. 시간 컬럼의 tz 표현이
테이블마다 달라(audit/mail=naive UTC, refresh=tz-aware UTC) 비교 전에 정규화한다.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
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


async def get_overview(
    db: AsyncSession, from_dt: datetime | None, to_dt: datetime | None
) -> dict:
    """기본 운영 통계 (R18.1): 로그인/조회/새로고침/메일 성공·실패 + 실패 Job 수."""
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)
    af, at = _as_aware_utc(from_dt), _as_aware_utc(to_dt)

    def _audit_range(stmt):
        if nf is not None:
            stmt = stmt.where(AuditLog.occurred_at_utc >= nf)
        if nt is not None:
            stmt = stmt.where(AuditLog.occurred_at_utc <= nt)
        return stmt

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

    return {
        "login_count": login_count,
        "report_view_count": report_view_count,
        "refresh_success": refresh_success,
        "refresh_failed": refresh_failed,
        "mail_success": mail_success,
        "mail_failed": mail_failed,
        "failed_job_count": mail_failed + export_failed,
    }


async def get_usage(
    db: AsyncSession, from_dt: datetime | None, to_dt: datetime | None
) -> dict:
    """사용 통계 (R18.2): TOP10/부서별 리포트수·조회수/월별/사용자별/메일/Export/Refresh실패/미사용."""
    nf, nt = _as_naive_utc(from_dt), _as_naive_utc(to_dt)

    def _audit_view_range(stmt):
        stmt = stmt.where(AuditLog.action == AuditAction.REPORT_VIEW)
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
    folder_rows = (await db.execute(
        select(ReportFolder.id, ReportFolder.name, func.count(Report.id).label("cnt"))
        .select_from(Report)
        .outerjoin(ReportFolder, ReportFolder.id == Report.folder_id)
        .group_by(ReportFolder.id, ReportFolder.name)
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
    month_rows = (await db.execute(
        select(month_expr.label("month"), func.count().label("cnt"))
        .group_by(month_expr)
        .order_by(month_expr)
    )).all()
    reports_by_month = [{"month": m, "count": int(c)} for m, c in month_rows]

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

    # 미사용 리포트 (UNUSED_REPORT_DAYS 동안 조회 이력 없는 공개 리포트)
    unused_reports = await _unused_reports(db)

    return {
        "top_reports": top_reports,
        "by_user": by_user,
        "reports_by_department": reports_by_department,
        "views_by_department": views_by_department,
        "reports_by_month": reports_by_month,
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


async def _unused_reports(db: AsyncSession) -> list[dict]:
    """UNUSED_REPORT_DAYS 동안 report_view 이력이 없는 공개 리포트 목록."""
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

    published = (await db.execute(
        select(Report).where(Report.is_published.is_(True))
    )).scalars().all()
    return [
        {"report_id": r.id, "report_name": r.display_name or r.report_name}
        for r in published
        if r.id not in viewed_ids
    ]
