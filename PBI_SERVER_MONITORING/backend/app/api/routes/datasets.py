"""Datasets metadata endpoint (``GET /api/datasets``).

Design reference: "API 엔드포인트 명세 - GET /api/datasets".

Returns the workspace's datasets as ``{datasetId, datasetName}`` (Requirement
8.3). Data comes only through the injected ``PowerBIClient`` Protocol, so the
response is identical in Mock_Mode and Live_Mode (basis for Property 6).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import PowerBIClientDep, SettingsDep
from app.schemas.dataset import DatasetOut

router = APIRouter(tags=["metadata"])


@router.get("/datasets", response_model=list[DatasetOut])
async def list_datasets(
    client: PowerBIClientDep, settings: SettingsDep
) -> list[DatasetOut]:
    """Return the workspace's datasets."""
    datasets = await client.list_datasets(settings.POWERBI_WORKSPACE_ID)
    return [
        DatasetOut(datasetId=ds.dataset_id, datasetName=ds.dataset_name)
        for ds in datasets
    ]
