"""Refresh Query — 레포트 새로고침 상태 + 타임테이블/히스토리 조회 (DB 기반)."""
from __future__ import annotations

from datetime import date as date_type, datetime, time, timedelta
from zoneinfo import ZoneInfo

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


# ── 예약 새로고침: 다음 갱신 예정 시각 ──────────────────────────────────────
# Power BI가 반환하는 예약 타임존(Windows tz id) → IANA 매핑. 없으면 APP_TIMEZONE 폴백.
_WINDOWS_TZ_TO_IANA: dict[str, str] = {
    "Korea Standard Time": "Asia/Seoul",
    "Tokyo Standard Time": "Asia/Tokyo",
    "China Standard Time": "Asia/Shanghai",
    "Taipei Standard Time": "Asia/Taipei",
    "Singapore Standard Time": "Asia/Singapore",
    "UTC": "UTC",
    "GMT Standard Time": "Europe/London",
    "Pacific Standard Time": "America/Los_Angeles",
    "Eastern Standard Time": "America/New_York",
}
_WEEKDAY_TO_NUM: dict[str, int] = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
}


def _resolve_schedule_tz(win_tz: str | None):
    """예약 타임존 문자열 → tzinfo. 매핑 실패 시 APP_TIMEZONE."""
    if not win_tz:
        return get_app_tz()
    iana = _WINDOWS_TZ_TO_IANA.get(win_tz)
    for candidate in (iana, win_tz):
        if candidate:
            try:
                return ZoneInfo(candidate)
            except Exception:  # noqa: BLE001
                continue
    return get_app_tz()


def compute_next_scheduled(
    days: list[str] | None, times: list[str] | None, timezone_str: str | None
) -> datetime | None:
    """요일 목록 + 시간(HH:MM) 목록 + 타임존으로 '지금 이후 가장 이른' 예약 시각(tz-aware) 계산."""
    if not days or not times:
        return None
    tz = _resolve_schedule_tz(timezone_str)
    day_nums = {_WEEKDAY_TO_NUM[d.strip().lower()] for d in days if d.strip().lower() in _WEEKDAY_TO_NUM}
    if not day_nums:
        return None
    parsed_times: list[time] = []
    for t in times:
        try:
            hh, mm = str(t).split(":")[:2]
            parsed_times.append(time(int(hh), int(mm)))
        except (ValueError, TypeError):
            continue
    if not parsed_times:
        return None

    now = datetime.now(tz)
    best: datetime | None = None
    for offset in range(0, 8):  # 주 단위 반복 커버(앞으로 8일)
        d = (now + timedelta(days=offset)).date()
        if d.weekday() not in day_nums:
            continue
        for pt in parsed_times:
            cand = datetime.combine(d, pt, tzinfo=tz)
            if cand > now and (best is None or cand < best):
                best = cand
    return best


async def get_schedule_info(db: AsyncSession, workspace_id: str, dataset_id: str) -> dict | None:
    """dataset의 예약 새로고침 정보(요일/시간/활성 + 다음 예정 시각). 예약 없으면 None."""
    sched = await db.scalar(
        select(RefreshSchedule).where(
            RefreshSchedule.workspace_id == workspace_id,
            RefreshSchedule.dataset_id == dataset_id,
        )
    )
    if sched is None:
        return None
    days = list(sched.days or [])
    times = list(sched.times or [])
    nxt = compute_next_scheduled(days, times, sched.timezone) if sched.enabled else None
    return {
        "enabled": bool(sched.enabled),
        "days": days,
        "times": times,
        "timezone": sched.timezone,
        "next_scheduled_local": nxt.astimezone(get_app_tz()).isoformat() if nxt else None,
    }
