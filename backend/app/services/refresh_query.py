"""Refresh Query — 레포트 새로고침 상태 + 타임테이블/히스토리 조회 (DB 기반)."""
from __future__ import annotations

from datetime import date as date_type, datetime, time, timedelta

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import get_app_tz, local_isoformat
from app.models.refresh import RefreshRun, RefreshSchedule
from app.models.report import Dataset, Report
from app.schemas.refresh import RefreshRunOut, RefreshStatusResponse


async def get_refresh_status(db: AsyncSession, report: Report) -> RefreshStatusResponse:
    """report의 dataset 기준 마지막 Refresh_Run + 다음 예약 반환 (단일 레포트용)."""
    if not report.dataset_id:
        return RefreshStatusResponse(has_history=False, message="새로고침 이력 없음")

    last = await db.scalar(
        select(RefreshRun)
        .where(
            RefreshRun.workspace_id == report.workspace_id,
            RefreshRun.dataset_id == report.dataset_id,
        )
        .order_by(RefreshRun.start_time_utc.desc().nulls_last())
        .limit(1)
    )

    if last is None:
        return RefreshStatusResponse(has_history=False, message="새로고침 이력 없음")

    return RefreshStatusResponse(
        has_history=True,
        status=last.status,
        last_refresh_local=local_isoformat(last.start_time_utc) if last.start_time_utc else None,
        next_scheduled_local=None,  # v1.1+에서 cron 파싱 구현
    )


async def query_refresh_history(
    session: AsyncSession, workspace_id: str, *, target_date: date_type
) -> list[RefreshRunOut]:
    """특정 날짜(APP_TIMEZONE 기준)의 Refresh_Run 목록."""
    tz = get_app_tz()
    day_start = datetime.combine(target_date, time.min, tzinfo=tz)
    day_end = day_start + timedelta(days=1)

    stmt = (
        select(
            RefreshRun,
            Report.report_id.label("r_report_id"),
            Report.report_name.label("r_report_name"),
            Dataset.dataset_name.label("d_dataset_name"),
        )
        .outerjoin(Dataset, and_(
            Dataset.workspace_id == RefreshRun.workspace_id,
            Dataset.dataset_id == RefreshRun.dataset_id,
        ))
        .outerjoin(Report, and_(
            Report.workspace_id == RefreshRun.workspace_id,
            Report.dataset_id == RefreshRun.dataset_id,
        ))
        .where(
            RefreshRun.workspace_id == workspace_id,
            RefreshRun.start_time_utc >= day_start,
            RefreshRun.start_time_utc < day_end,
        )
        .order_by(RefreshRun.start_time_utc.desc())
    )
    rows = await session.execute(stmt)
    result = []
    for rr, r_rid, r_rname, d_name in rows.all():
        result.append(RefreshRunOut(
            reportId=r_rid,
            reportName=r_rname or "알 수 없음",
            datasetId=rr.dataset_id,
            datasetName=d_name or "데이터셋 없음",
            refreshType=getattr(rr, "refresh_type", None),
            status=rr.status,
            startTimeUtc=rr.start_time_utc.isoformat() if rr.start_time_utc else None,
            endTimeUtc=rr.end_time_utc.isoformat() if rr.end_time_utc else None,
            startTimeLocal=local_isoformat(rr.start_time_utc) if rr.start_time_utc else None,
            endTimeLocal=local_isoformat(rr.end_time_utc) if rr.end_time_utc else None,
            durationSeconds=rr.duration_seconds,
            requestId=rr.request_id,
            errorMessage=rr.error_message,
        ))
    return result


async def query_refresh_timetable(
    session: AsyncSession,
    workspace_id: str,
    *,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
    status: str | None = None,
    report_id: str | None = None,
    dataset_id: str | None = None,
) -> list[RefreshRunOut]:
    """필터 적용 Refresh_Run 목록 (Gantt/테이블용)."""
    stmt = (
        select(
            RefreshRun,
            Report.report_id.label("r_report_id"),
            Report.report_name.label("r_report_name"),
            Dataset.dataset_name.label("d_dataset_name"),
        )
        .outerjoin(Dataset, and_(
            Dataset.workspace_id == RefreshRun.workspace_id,
            Dataset.dataset_id == RefreshRun.dataset_id,
        ))
        .outerjoin(Report, and_(
            Report.workspace_id == RefreshRun.workspace_id,
            Report.dataset_id == RefreshRun.dataset_id,
        ))
        .where(RefreshRun.workspace_id == workspace_id)
    )
    if from_dt:
        stmt = stmt.where(RefreshRun.start_time_utc >= from_dt)
    if to_dt:
        stmt = stmt.where(RefreshRun.start_time_utc <= to_dt)
    if status:
        stmt = stmt.where(RefreshRun.status == status)
    if dataset_id:
        stmt = stmt.where(RefreshRun.dataset_id == dataset_id)
    stmt = stmt.order_by(RefreshRun.start_time_utc.desc())

    rows = await session.execute(stmt)
    result = []
    for rr, r_rid, r_rname, d_name in rows.all():
        if report_id and r_rid != report_id:
            continue
        result.append(RefreshRunOut(
            reportId=r_rid,
            reportName=r_rname or "알 수 없음",
            datasetId=rr.dataset_id,
            datasetName=d_name or "데이터셋 없음",
            refreshType=getattr(rr, "refresh_type", None),
            status=rr.status,
            startTimeUtc=rr.start_time_utc.isoformat() if rr.start_time_utc else None,
            endTimeUtc=rr.end_time_utc.isoformat() if rr.end_time_utc else None,
            startTimeLocal=local_isoformat(rr.start_time_utc) if rr.start_time_utc else None,
            endTimeLocal=local_isoformat(rr.end_time_utc) if rr.end_time_utc else None,
            durationSeconds=rr.duration_seconds,
            requestId=rr.request_id,
            errorMessage=rr.error_message,
        ))
    return result
