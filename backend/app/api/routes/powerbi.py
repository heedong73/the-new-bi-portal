"""Power BI 워크스페이스 메타 조회 — /api/powerbi (System_Operator).

레포트 등록 화면에서 라이브 워크스페이스의 레포트를 골라 등록할 수 있도록,
PBI 워크스페이스의 레포트 목록(+ dataset 이름)을 조회해 제공한다. 읽기 전용.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.core.config import settings
from app.core.constants import RoleCode
from app.core.deps import PowerBIClientDep, require_role
from app.schemas.report import WorkspaceReportItem

router = APIRouter(prefix="/api/powerbi", tags=["powerbi"])

_require_operator = require_role(RoleCode.SYSTEM_OPERATOR)


@router.get("/workspace-reports", response_model=list[WorkspaceReportItem])
async def list_workspace_reports(
    client: PowerBIClientDep,
    workspace_id: str | None = Query(default=None, description="미지정 시 기본 워크스페이스"),
    _op=Depends(_require_operator),
):
    """라이브 PBI 워크스페이스의 레포트 목록 (등록 화면 선택용)."""
    ws = workspace_id or settings.POWERBI_WORKSPACE_ID
    reports = await client.list_reports(ws)
    datasets = await client.list_datasets(ws)
    ds_name = {d.dataset_id: d.dataset_name for d in datasets}

    return [
        WorkspaceReportItem(
            workspace_id=ws,
            report_id=r.report_id,
            report_name=r.report_name,
            dataset_id=r.dataset_id,
            dataset_name=ds_name.get(r.dataset_id) if r.dataset_id else None,
        )
        for r in reports
    ]
