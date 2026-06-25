"""Refresh schedules endpoint (``GET /api/refresh-schedules``).

Design reference: "API 엔드포인트 명세 - GET /api/refresh-schedules".

Returns each dataset's scheduled refresh configuration (days, times, timezone,
enabled) keyed by dataset, with the dataset name resolved from the catalogue
(Requirement 8.4). Data comes only through the injected ``PowerBIClient``
Protocol, so the response is identical in Mock_Mode and Live_Mode (Property 6).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import PowerBIClientDep, SettingsDep
from app.schemas.schedule import ScheduleOut

router = APIRouter(tags=["metadata"])


@router.get("/refresh-schedules", response_model=list[ScheduleOut])
async def list_refresh_schedules(
    client: PowerBIClientDep, settings: SettingsDep
) -> list[ScheduleOut]:
    """Return per-dataset refresh schedules.

    For each dataset in the workspace, ``get_refresh_schedule`` is called and
    combined with the dataset name to build a ``ScheduleOut``.
    """
    workspace_id = settings.POWERBI_WORKSPACE_ID

    datasets = await client.list_datasets(workspace_id)

    schedules: list[ScheduleOut] = []
    for ds in datasets:
        schedule = await client.get_refresh_schedule(workspace_id, ds.dataset_id)
        schedules.append(
            ScheduleOut(
                datasetId=ds.dataset_id,
                datasetName=ds.dataset_name,
                days=schedule.days,
                times=schedule.times,
                timezone=schedule.timezone,
                enabled=schedule.enabled,
            )
        )

    return schedules
