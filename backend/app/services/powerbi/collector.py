"""Refresh_Collector — Workspace 범위 수집을 PostgreSQL에 upsert.

design.md "Refresh_Collector", Property 5(upsert 멱등성) 참조.
PRM collector.py를 우리 모델 구조에 맞게 조정:
- 모델 import 경로 통합 (app.models.refresh, app.models.report)
- 우리 모델에 없는 컬럼(report_id/report_name/dataset_name/updated_at) 제거
- compute_time_columns는 우리 core/timezone.py 사용
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import compute_time_columns
from app.models.refresh import RefreshRun, RefreshSchedule
from app.models.report import Report, Dataset, Workspace
from app.services.powerbi.client import (
    DatasetDTO,
    PowerBIClient,
    RefreshRunDTO,
    RefreshScheduleDTO,
    ReportDTO,
)
from app.services.powerbi.error_parser import parse_service_exception
from app.services.powerbi.status_mapper import map_status

async def upsert_workspace(session: AsyncSession, workspace_id: str, name: str) -> None:
    stmt = pg_insert(Workspace).values(workspace_id=workspace_id, workspace_name=name)
    stmt = stmt.on_conflict_do_update(
        index_elements=["workspace_id"],
        set_={"workspace_name": stmt.excluded.workspace_name},
    )
    await session.execute(stmt)

async def upsert_reports(
    session: AsyncSession, workspace_id: str, reports: list[ReportDTO]
) -> None:
    if not reports:
        return
    rows = [
        {"workspace_id": workspace_id, "report_id": r.report_id,
         "report_name": r.report_name, "dataset_id": r.dataset_id}
        for r in reports
    ]
    stmt = pg_insert(Report).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["workspace_id", "report_id"],
        set_={"report_name": stmt.excluded.report_name,
              "dataset_id": stmt.excluded.dataset_id},
    )
    await session.execute(stmt)

async def upsert_datasets(
    session: AsyncSession, workspace_id: str, datasets: list[DatasetDTO]
) -> None:
    if not datasets:
        return
    rows = [
        {"workspace_id": workspace_id, "dataset_id": d.dataset_id,
         "dataset_name": d.dataset_name}
        for d in datasets
    ]
    stmt = pg_insert(Dataset).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["workspace_id", "dataset_id"],
        set_={"dataset_name": stmt.excluded.dataset_name},
    )
    await session.execute(stmt)

async def upsert_refresh_schedule(
    session: AsyncSession, workspace_id: str, schedule: RefreshScheduleDTO
) -> None:
    stmt = pg_insert(RefreshSchedule).values(
        workspace_id=workspace_id, dataset_id=schedule.dataset_id,
        days=list(schedule.days), times=list(schedule.times),
        timezone=schedule.timezone, enabled=schedule.enabled,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["workspace_id", "dataset_id"],
        set_={"days": stmt.excluded.days, "times": stmt.excluded.times,
              "timezone": stmt.excluded.timezone, "enabled": stmt.excluded.enabled},
    )
    await session.execute(stmt)

def dto_to_row(workspace_id: str, run: RefreshRunDTO) -> dict[str, Any]:
    """RefreshRunDTO → refresh_runs 컬럼 dict."""
    has_end_time = run.end_time is not None
    status = map_status(run.status, has_end_time)
    error_message = parse_service_exception(run.service_exception_json)
    cols = compute_time_columns(run.start_time, run.end_time)
    return {
        "workspace_id": workspace_id,
        "dataset_id": run.dataset_id,
        "request_id": run.request_id,
        "status": status,
        "start_time_utc": cols["start_time_utc"],
        "end_time_utc": cols["end_time_utc"],
        "start_time_local": cols["start_time_local"],
        "end_time_local": cols["end_time_local"],
        "duration_seconds": cols["duration_seconds"],
        "error_message": error_message,
        "raw_json": run.raw_json,
    }

async def upsert_refresh_run(session: AsyncSession, row: dict[str, Any]) -> None:
    """refresh_runs upsert (멱등, Property 5)."""
    stmt = pg_insert(RefreshRun).values(**row)
    stmt = stmt.on_conflict_do_update(
        index_elements=["workspace_id", "dataset_id", "request_id"],
        set_={
            "status": stmt.excluded.status,
            "end_time_utc": stmt.excluded.end_time_utc,
            "end_time_local": stmt.excluded.end_time_local,
            "duration_seconds": stmt.excluded.duration_seconds,
            "error_message": stmt.excluded.error_message,
            "raw_json": stmt.excluded.raw_json,
        },
    )
    await session.execute(stmt)

async def collect_workspace(
    session: AsyncSession, client: PowerBIClient, workspace_id: str
) -> dict[str, int]:
    """workspace 범위 데이터 수집 → PostgreSQL upsert."""
    await upsert_workspace(session, workspace_id, workspace_id)
    reports = await client.list_reports(workspace_id)
    await upsert_reports(session, workspace_id, reports)
    datasets = await client.list_datasets(workspace_id)
    await upsert_datasets(session, workspace_id, datasets)

    run_count = 0
    for ds in datasets:
        refreshes = await client.list_refreshes(workspace_id, ds.dataset_id)
        for run in refreshes:
            await upsert_refresh_run(session, dto_to_row(workspace_id, run))
            run_count += 1
        schedule = await client.get_refresh_schedule(workspace_id, ds.dataset_id)
        await upsert_refresh_schedule(session, workspace_id, schedule)

    return {"reports": len(reports), "datasets": len(datasets), "refresh_runs": run_count}
