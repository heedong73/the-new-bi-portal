"""Refresh_Collector — Workspace-scoped collection into PostgreSQL.

Design reference: "Refresh_Collector".

This module owns the **write path**: it takes raw ``PowerBIClient`` DTOs and
upserts them into the normalized tables (``workspaces`` / ``reports`` /
``datasets`` / ``refresh_runs`` / ``refresh_schedules``). The **read path**
(Report ↔ Refresh History join) lives in ``services/refresh_query.py`` and reads
from these tables exclusively. The two paths are deliberately separated
(Requirement 4.5 / 6.x): collection normalizes Dataset-granular data, queries
fan it out to Report granularity.

All upserts use PostgreSQL ``INSERT ... ON CONFLICT DO UPDATE`` keyed on each
table's natural UNIQUE constraint, giving idempotent collection (Property 1):
re-running collection never duplicates rows.

``refresh_runs`` upsert specifics:

- **Idempotency / selective update (Requirement 4.5, 4.6):** conflict on
  ``(workspace_id, dataset_id, request_id)`` updates the volatile columns
  (``status`` / ``end_time_*`` / ``duration_seconds`` / ``error_message`` /
  ``raw_json``) so an in-progress run becomes ``success``/``failed`` on the next
  cycle with its end time and duration filled in.
- **Missing-field preservation (Property 1):** the denormalized identity
  columns (``report_id`` / ``report_name`` / ``dataset_name``) use
  ``COALESCE(EXCLUDED.col, table.col)`` so a later DTO that omits them (NULL)
  keeps the previously stored value rather than wiping it.

The Redis distributed lock that guards concurrent collection is applied by the
Celery task (stage 5/6); ``collect_workspace`` here is pure collection logic.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import compute_time_columns
from app.models.dataset import Dataset
from app.models.refresh_run import RefreshRun
from app.models.refresh_schedule import RefreshSchedule
from app.models.report import Report
from app.models.workspace import Workspace
from app.services.powerbi.client import (
    DatasetDTO,
    PowerBIClient,
    RefreshRunDTO,
    RefreshScheduleDTO,
    ReportDTO,
)
from app.services.powerbi.error_parser import parse_service_exception
from app.services.powerbi.status_mapper import map_status


async def upsert_workspace(
    session: AsyncSession, workspace_id: str, name: str
) -> None:
    """Upsert a workspace row (PK ``workspace_id``).

    On conflict, refreshes ``workspace_name`` and ``updated_at``.
    """
    stmt = pg_insert(Workspace).values(
        workspace_id=workspace_id,
        workspace_name=name,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["workspace_id"],
        set_={
            "workspace_name": stmt.excluded.workspace_name,
            "updated_at": func.now(),
        },
    )
    await session.execute(stmt)


async def upsert_reports(
    session: AsyncSession, workspace_id: str, reports: list[ReportDTO]
) -> None:
    """Upsert reports keyed on ``(workspace_id, report_id)``.

    On conflict, refreshes ``report_name`` / ``dataset_id`` (a report may be
    re-pointed at a different dataset) and ``updated_at``.
    """
    if not reports:
        return
    rows = [
        {
            "workspace_id": workspace_id,
            "report_id": r.report_id,
            "report_name": r.report_name,
            "dataset_id": r.dataset_id,
        }
        for r in reports
    ]
    stmt = pg_insert(Report).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["workspace_id", "report_id"],
        set_={
            "report_name": stmt.excluded.report_name,
            "dataset_id": stmt.excluded.dataset_id,
            "updated_at": func.now(),
        },
    )
    await session.execute(stmt)


async def upsert_datasets(
    session: AsyncSession, workspace_id: str, datasets: list[DatasetDTO]
) -> None:
    """Upsert datasets keyed on ``(workspace_id, dataset_id)``.

    On conflict, refreshes ``dataset_name`` and ``updated_at``.
    """
    if not datasets:
        return
    rows = [
        {
            "workspace_id": workspace_id,
            "dataset_id": d.dataset_id,
            "dataset_name": d.dataset_name,
        }
        for d in datasets
    ]
    stmt = pg_insert(Dataset).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["workspace_id", "dataset_id"],
        set_={
            "dataset_name": stmt.excluded.dataset_name,
            "updated_at": func.now(),
        },
    )
    await session.execute(stmt)


async def upsert_refresh_schedule(
    session: AsyncSession, workspace_id: str, schedule: RefreshScheduleDTO
) -> None:
    """Upsert a dataset's refresh schedule keyed on ``(workspace_id, dataset_id)``.

    On conflict, refreshes ``days`` / ``times`` / ``timezone`` / ``enabled`` and
    ``updated_at``.
    """
    stmt = pg_insert(RefreshSchedule).values(
        workspace_id=workspace_id,
        dataset_id=schedule.dataset_id,
        days=list(schedule.days),
        times=list(schedule.times),
        timezone=schedule.timezone,
        enabled=schedule.enabled,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["workspace_id", "dataset_id"],
        set_={
            "days": stmt.excluded.days,
            "times": stmt.excluded.times,
            "timezone": stmt.excluded.timezone,
            "enabled": stmt.excluded.enabled,
            "updated_at": func.now(),
        },
    )
    await session.execute(stmt)


def dto_to_row(
    workspace_id: str, dataset_name: str | None, run: RefreshRunDTO
) -> dict[str, Any]:
    """Map a raw ``RefreshRunDTO`` to a ``refresh_runs`` column dict.

    Performs the per-row transforms shared with the read path:

    - ``status`` via :func:`map_status` (raw Power BI status + has-end-time).
    - ``error_message`` via :func:`parse_service_exception`.
    - dual UTC/local time columns + finished ``duration_seconds`` via
      :func:`compute_time_columns` (in-progress runs get ``None`` here; the
      live elapsed time is computed at query time, Requirement 7.4).
    - ``raw_json`` preserved verbatim (Requirement 4.10).

    ``report_id`` / ``report_name`` are ``None``: Power BI refresh history is
    Dataset-granular and carries no report identity. The read-path JOIN fills
    report fields from the ``reports`` table.
    """
    has_end_time = run.end_time is not None
    status = map_status(run.status, has_end_time)
    error_message = parse_service_exception(run.service_exception_json)
    cols = compute_time_columns(run.start_time, run.end_time)

    return {
        "workspace_id": workspace_id,
        "report_id": None,
        "report_name": None,
        "dataset_id": run.dataset_id,
        "dataset_name": dataset_name,
        "refresh_type": run.refresh_type,
        "status": status,
        "start_time_utc": cols["start_time_utc"],
        "end_time_utc": cols["end_time_utc"],
        "start_time_local": cols["start_time_local"],
        "end_time_local": cols["end_time_local"],
        "duration_seconds": cols["duration_seconds"],
        "request_id": run.request_id,
        "error_message": error_message,
        "raw_json": run.raw_json,
    }


async def upsert_refresh_run(session: AsyncSession, row: dict[str, Any]) -> None:
    """Upsert one ``refresh_runs`` row keyed on ``(workspace_id, dataset_id, request_id)``.

    Idempotent (Property 1): re-applying the same key never duplicates the row.
    On conflict:

    - Volatile columns (``status`` / ``end_time_*`` / ``duration_seconds`` /
      ``error_message`` / ``raw_json`` / ``refresh_type`` / ``start_time_*``)
      take the new (``EXCLUDED``) value so an in-progress run transitions to its
      finished state with end time + duration filled in (Requirement 4.6).
    - Identity columns (``report_id`` / ``report_name`` / ``dataset_name``) use
      ``COALESCE(EXCLUDED, existing)`` so a later DTO that omits them keeps the
      previously stored value (missing-field preservation, Property 1).
    """
    stmt = pg_insert(RefreshRun).values(**row)
    stmt = stmt.on_conflict_do_update(
        index_elements=["workspace_id", "dataset_id", "request_id"],
        set_={
            # Identity / denormalized columns: preserve existing on NULL.
            "report_id": func.coalesce(
                stmt.excluded.report_id, RefreshRun.report_id
            ),
            "report_name": func.coalesce(
                stmt.excluded.report_name, RefreshRun.report_name
            ),
            "dataset_name": func.coalesce(
                stmt.excluded.dataset_name, RefreshRun.dataset_name
            ),
            # Volatile columns: always take the latest value.
            "refresh_type": stmt.excluded.refresh_type,
            "status": stmt.excluded.status,
            "start_time_utc": stmt.excluded.start_time_utc,
            "start_time_local": stmt.excluded.start_time_local,
            "end_time_utc": stmt.excluded.end_time_utc,
            "end_time_local": stmt.excluded.end_time_local,
            "duration_seconds": stmt.excluded.duration_seconds,
            "error_message": stmt.excluded.error_message,
            "raw_json": stmt.excluded.raw_json,
            "updated_at": func.now(),
        },
    )
    await session.execute(stmt)


async def collect_workspace(
    session: AsyncSession, client: PowerBIClient, workspace_id: str
) -> dict[str, int]:
    """Collect a single workspace's data into PostgreSQL (pure collection).

    Flow (design.md "Refresh_Collector" sequence):

    1. Upsert the workspace.
    2. ``list_reports`` -> upsert reports.
    3. ``list_datasets`` -> upsert datasets (and build the ``dataset_id ->
       name`` map for denormalization).
    4. For each dataset: ``list_refreshes`` -> upsert each run, and
       ``get_refresh_schedule`` -> upsert the schedule.

    The caller is responsible for the Redis lock and for committing the
    session. Returns simple counts for logging/diagnostics.
    """
    await upsert_workspace(session, workspace_id, workspace_id)

    reports = await client.list_reports(workspace_id)
    await upsert_reports(session, workspace_id, reports)

    datasets = await client.list_datasets(workspace_id)
    await upsert_datasets(session, workspace_id, datasets)
    dataset_names = {ds.dataset_id: ds.dataset_name for ds in datasets}

    run_count = 0
    for ds in datasets:
        refreshes = await client.list_refreshes(workspace_id, ds.dataset_id)
        for run in refreshes:
            row = dto_to_row(
                workspace_id,
                dataset_names.get(run.dataset_id),
                run,
            )
            await upsert_refresh_run(session, row)
            run_count += 1

        schedule = await client.get_refresh_schedule(workspace_id, ds.dataset_id)
        await upsert_refresh_schedule(session, workspace_id, schedule)

    return {
        "reports": len(reports),
        "datasets": len(datasets),
        "refresh_runs": run_count,
    }
