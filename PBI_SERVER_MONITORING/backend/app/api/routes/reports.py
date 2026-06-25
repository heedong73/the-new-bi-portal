"""Reports metadata endpoint (``GET /api/reports``).

Design reference: "API 엔드포인트 명세 - GET /api/reports", "Reports ↔ Refresh
History 조인".

Returns the workspace's reports with the dataset name resolved by joining each
report's ``datasetId`` against the dataset catalogue. Paginated reports have no
``datasetId``; their ``datasetName`` is rendered as "데이터셋 없음" (Requirement
6.3, 8.2).

Data is obtained exclusively through the injected ``PowerBIClient`` Protocol;
this route never branches on Mock_Mode vs Live_Mode (that decision lives in
``get_powerbi_client``). This keeps the mock/live response identical — the basis
for Property 6.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.constants import NO_DATASET_NAME
from app.core.deps import PowerBIClientDep, SettingsDep
from app.schemas.report import ReportOut

router = APIRouter(tags=["metadata"])


@router.get("/reports", response_model=list[ReportOut])
async def list_reports(
    client: PowerBIClientDep, settings: SettingsDep
) -> list[ReportOut]:
    """Return the workspace's reports with resolved dataset names.

    The ``datasetId -> datasetName`` mapping is built from ``list_datasets``.
    When a report has no ``datasetId`` (paginated report) or its ``datasetId``
    is not present in the catalogue, ``datasetName`` falls back to
    "데이터셋 없음" (Requirement 6.3).
    """
    workspace_id = settings.POWERBI_WORKSPACE_ID

    reports = await client.list_reports(workspace_id)
    datasets = await client.list_datasets(workspace_id)

    dataset_names = {ds.dataset_id: ds.dataset_name for ds in datasets}

    return [
        ReportOut(
            reportId=report.report_id,
            reportName=report.report_name,
            datasetId=report.dataset_id,
            datasetName=(
                dataset_names.get(report.dataset_id, NO_DATASET_NAME)
                if report.dataset_id is not None
                else NO_DATASET_NAME
            ),
        )
        for report in reports
    ]
