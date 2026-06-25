"""PBIX Import Worker task — 업로드 PBIX를 Power BI에 게시 후 카탈로그 반영.

흐름: POST imports → 상태 polling → 성공 시 reports/workspace upsert.
mock 모드: 외부 호출 없이 성공 시뮬레이션.
Import 진행 상태는 Celery result backend(task_id=importId)로 추적.
새로고침 필요 레포트는 "게이트웨이 설정 필요" 안내를 결과에 포함.
"""
from __future__ import annotations

import asyncio
from typing import Any

from sqlalchemy import select

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.report import Report, Workspace
from app.workers.celery_app import celery_app

async def _apply_catalog(workspace_id: str, report_id: str, dataset_id: str | None,
                         report_name: str | None, folder_id: int | None) -> dict[str, Any]:
    """workspace upsert + report 신규/갱신 (nameConflict=CreateOrOverwrite 의미)."""
    async with AsyncSessionLocal() as db:
        ws = await db.scalar(select(Workspace).where(Workspace.workspace_id == workspace_id))
        if ws is None:
            db.add(Workspace(workspace_id=workspace_id, workspace_name=workspace_id))
            await db.flush()

        report = await db.scalar(
            select(Report).where(
                Report.workspace_id == workspace_id, Report.report_id == report_id
            )
        )
        if report is None:
            report = Report(
                workspace_id=workspace_id, report_id=report_id, dataset_id=dataset_id,
                report_name=report_name, folder_id=folder_id, is_published=False,
            )
            db.add(report)
            created = True
        else:
            report.dataset_id = dataset_id
            report.report_name = report_name
            created = False
        await db.flush()
        await db.commit()
        return {"report_pk": report.id, "created": created}

def _powerbi_import(file_path: str, name_conflict: str) -> dict[str, Any]:
    """Power BI POST imports + polling. mock 모드는 시뮬레이션.

    live 모드 실제 구현은 LivePowerBIClient.import_pbix 추가 후 연결(아래 NotImplemented).
    """
    if settings.APP_MODE == "mock":
        # 외부 호출 없이 성공 시뮬레이션
        return {
            "status": "Succeeded",
            "report_id": f"mock-report-{abs(hash(file_path)) % 100000}",
            "dataset_id": f"mock-dataset-{abs(hash(file_path)) % 100000}",
        }
    # live 모드: 실제 Import API 호출 (T-19 live 연동 시 구현)
    raise NotImplementedError("live PBIX import는 LivePowerBIClient.import_pbix 구현 후 연결")

@celery_app.task(name="bip.pbix_import")
def pbix_import(
    file_path: str,
    workspace_id: str,
    report_name: str | None = None,
    folder_id: int | None = None,
    name_conflict: str = "CreateOrOverwrite",
) -> dict[str, Any]:
    """PBIX import 작업 진입점 (Celery sync task → asyncio.run으로 async 처리)."""
    result = _powerbi_import(file_path, name_conflict)
    if result.get("status") != "Succeeded":
        return {"status": "Failed", "reason": result.get("status")}

    catalog = asyncio.run(_apply_catalog(
        workspace_id=workspace_id,
        report_id=result["report_id"],
        dataset_id=result.get("dataset_id"),
        report_name=report_name,
        folder_id=folder_id,
    ))

    return {
        "status": "Succeeded",
        "report_id": result["report_id"],
        "dataset_id": result.get("dataset_id"),
        "report_pk": catalog["report_pk"],
        "created": catalog["created"],
        "notice": "데이터셋 자격증명/게이트웨이 설정이 별도로 필요할 수 있습니다.",
    }
