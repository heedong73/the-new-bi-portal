"""PBIX Import Worker task — 업로드 PBIX를 Power BI에 게시 후 카탈로그 반영.

흐름: POST imports → 상태 polling → 성공 시 reports/workspace upsert.
mock 모드: 외부 호출 없이 성공 시뮬레이션.
Import 진행 상태는 Celery result backend(task_id=importId)로 추적.
새로고침 필요 레포트는 "게이트웨이 설정 필요" 안내를 결과에 포함.
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import httpx
from sqlalchemy import select

from app.core.config import settings
from app.core.logging import get_logger
from app.db.redis import redis_client
from app.db.session import AsyncSessionLocal
from app.models.report import Report, Workspace
from app.services.powerbi.token_service import MockTokenService, TokenService
from app.workers.celery_app import celery_app

logger = get_logger(__name__)

_IMPORT_POLL_INTERVAL_SEC = 3
_IMPORT_POLL_TIMEOUT_SEC = 300

async def _apply_catalog(workspace_id: str, report_id: str, dataset_id: str | None,
                         report_name: str | None, folder_id: int | None,
                         description: str | None = None,
                         created_by_user_id: int | None = None,
                         created_by_label: str | None = None) -> dict[str, Any]:
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
                report_name=report_name, folder_id=folder_id, is_published=True,
                description=description,
                created_by_user_id=created_by_user_id, created_by_label=created_by_label,
            )
            db.add(report)
            created = True
        else:
            report.dataset_id = dataset_id
            report.report_name = report_name
            if description is not None:
                report.description = description
            created = False
        await db.flush()
        await db.commit()
        return {"report_pk": report.id, "created": created}

async def _powerbi_import_live(file_path: str, workspace_id: str, dataset_display_name: str,
                               name_conflict: str) -> dict[str, Any]:
    """live Power BI Import API: POST imports(multipart) → GET imports/{id} 폴링."""
    token_service = (
        MockTokenService() if settings.APP_MODE == "mock"
        else TokenService(settings=settings, redis=redis_client)
    )
    token = await token_service.get_token()
    base = settings.POWERBI_API_BASE_URL.rstrip("/")
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(connect=5.0, read=120.0, write=120.0, pool=120.0),
        verify=settings.POWERBI_VERIFY_SSL,
    ) as client:
        # 1) 업로드 (multipart). datasetDisplayName 은 .pbix 확장자 포함 권장.
        with open(file_path, "rb") as fh:
            files = {"file": (dataset_display_name, fh, "application/octet-stream")}
            resp = await client.post(
                f"{base}/groups/{workspace_id}/imports",
                params={"datasetDisplayName": dataset_display_name,
                        "nameConflict": name_conflict},
                headers=headers,
                files=files,
            )
        if resp.status_code >= 400:
            return {"status": "Failed", "reason": f"import 요청 실패 (HTTP {resp.status_code}): {resp.text[:200]}"}
        import_id = resp.json().get("id")
        if not import_id:
            return {"status": "Failed", "reason": "importId를 받지 못했습니다."}

        # 2) 폴링
        deadline = time.monotonic() + _IMPORT_POLL_TIMEOUT_SEC
        while time.monotonic() < deadline:
            await asyncio.sleep(_IMPORT_POLL_INTERVAL_SEC)
            poll = await client.get(f"{base}/groups/{workspace_id}/imports/{import_id}", headers=headers)
            if poll.status_code >= 400:
                continue
            data = poll.json()
            state = data.get("importState")
            if state == "Succeeded":
                reports = data.get("reports") or []
                datasets = data.get("datasets") or []
                return {
                    "status": "Succeeded",
                    "report_id": reports[0]["id"] if reports else None,
                    "dataset_id": datasets[0]["id"] if datasets else None,
                    "report_name": reports[0].get("name") if reports else dataset_display_name,
                }
            if state == "Failed":
                return {"status": "Failed", "reason": "Power BI import 실패", "detail": data.get("error")}
        return {"status": "Failed", "reason": "import 폴링 타임아웃"}


def _powerbi_import(file_path: str, workspace_id: str, dataset_display_name: str,
                    name_conflict: str) -> dict[str, Any]:
    """Power BI Import 실행. mock 모드는 외부 호출 없이 시뮬레이션."""
    if settings.APP_MODE == "mock":
        return {
            "status": "Succeeded",
            "report_id": f"mock-report-{abs(hash(file_path)) % 100000}",
            "dataset_id": f"mock-dataset-{abs(hash(file_path)) % 100000}",
            "report_name": dataset_display_name,
        }
    return asyncio.run(_powerbi_import_live(file_path, workspace_id, dataset_display_name, name_conflict))

@celery_app.task(name="bip.pbix_import")
def pbix_import(
    file_path: str,
    workspace_id: str,
    report_name: str | None = None,
    folder_id: int | None = None,
    name_conflict: str = "CreateOrOverwrite",
    description: str | None = None,
    created_by_user_id: int | None = None,
    created_by_label: str | None = None,
) -> dict[str, Any]:
    """PBIX import 작업 진입점 (Celery sync task). 업로드→게시→카탈로그 반영."""
    display_name = report_name or "uploaded-report"
    if not display_name.lower().endswith(".pbix"):
        display_name = f"{display_name}.pbix"

    try:
        result = _powerbi_import(file_path, workspace_id, display_name, name_conflict)
    finally:
        # 임시 업로드 파일 정리
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except OSError:
            pass

    if result.get("status") != "Succeeded":
        return {"status": "Failed", "reason": result.get("reason") or result.get("status")}

    catalog = asyncio.run(_apply_catalog(
        workspace_id=workspace_id,
        report_id=result["report_id"],
        dataset_id=result.get("dataset_id"),
        report_name=report_name or result.get("report_name"),
        folder_id=folder_id,
        description=description,
        created_by_user_id=created_by_user_id,
        created_by_label=created_by_label,
    ))

    return {
        "status": "Succeeded",
        "report_id": result["report_id"],
        "dataset_id": result.get("dataset_id"),
        "report_pk": catalog["report_pk"],
        "created": catalog["created"],
        "notice": "데이터셋 자격증명/게이트웨이 설정이 별도로 필요할 수 있습니다.",
    }
