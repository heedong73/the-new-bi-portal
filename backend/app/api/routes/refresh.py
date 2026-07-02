"""새로고침 관련 라우트 — 타임테이블/히스토리/요약/데이터셋/스케줄."""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from app.core.config import settings
from app.core.deps import SessionDep, require_menu
from app.core.timezone import get_app_tz
from app.models.refresh import RefreshSchedule, RefreshRun
from app.models.report import Dataset
from app.schemas.refresh import DatasetOut, LatestDateOut, RefreshRunOut, ScheduleOut, SummaryOut
from app.services.refresh_query import query_refresh_history, query_refresh_timetable
from app.services.summary import build_summary

router = APIRouter(tags=["refresh"])


@router.get("/api/refresh-history", response_model=list[RefreshRunOut])
async def refresh_history(
    date: date = Query(...),
    *,
    db: SessionDep,
    current=Depends(require_menu("monitoring_refresh")),
):
    return await query_refresh_history(db, settings.POWERBI_WORKSPACE_ID, target_date=date)


@router.get("/api/refresh-timetable", response_model=list[RefreshRunOut])
async def refresh_timetable(
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    status: str | None = Query(None),
    reportId: str | None = Query(None),
    datasetId: str | None = Query(None),
    *,
    db: SessionDep,
    current=Depends(require_menu("monitoring_refresh")),
):
    from_dt = datetime.fromisoformat(from_) if from_ else None
    to_dt = datetime.fromisoformat(to) if to else None
    return await query_refresh_timetable(
        db, settings.POWERBI_WORKSPACE_ID,
        from_dt=from_dt, to_dt=to_dt, status=status,
        report_id=reportId, dataset_id=datasetId,
    )


@router.get("/api/summary", response_model=SummaryOut)
async def summary(
    date: date = Query(...),
    *,
    db: SessionDep,
    current=Depends(require_menu("monitoring_refresh")),
):
    runs = await query_refresh_history(db, settings.POWERBI_WORKSPACE_ID, target_date=date)
    return build_summary(runs)


@router.get("/api/refresh-latest-date", response_model=LatestDateOut)
async def refresh_latest_date(
    db: SessionDep,
    current=Depends(require_menu("monitoring_refresh")),
):
    """데이터가 있는 가장 최근 일자(APP_TZ 기준)를 반환한다.

    화면 최초 진입 시 기본 선택 일자로 사용한다(오늘 갱신이 없어도 최근 실행일이
    바로 표시되도록). 이력이 없으면 date=None.
    """
    max_utc = await db.scalar(
        select(func.max(RefreshRun.start_time_utc)).where(
            RefreshRun.workspace_id == settings.POWERBI_WORKSPACE_ID
        )
    )
    if max_utc is None:
        return LatestDateOut(date=None)
    return LatestDateOut(date=max_utc.astimezone(get_app_tz()).date().isoformat())


@router.get("/api/datasets", response_model=list[DatasetOut])
async def list_datasets(db: SessionDep, current=Depends(require_menu("monitoring_refresh"))):
    rows = (await db.execute(select(Dataset).order_by(Dataset.id))).scalars().all()
    return [DatasetOut(datasetId=r.dataset_id, datasetName=r.dataset_name) for r in rows]


@router.get("/api/refresh-schedules", response_model=list[ScheduleOut])
async def list_schedules(db: SessionDep, current=Depends(require_menu("monitoring_refresh"))):
    rows = (await db.execute(select(RefreshSchedule).order_by(RefreshSchedule.id))).scalars().all()
    return [ScheduleOut(
        datasetId=r.dataset_id, datasetName=None,
        days=r.days or [], times=r.times or [],
        timezone=r.timezone or "UTC", enabled=r.enabled,
    ) for r in rows]
