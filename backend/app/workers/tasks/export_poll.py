"""Export Poll Worker task — Power BI Export to File 비동기 폴링 + 파일 저장.

design.md "직접 Export 설계"(R9.6, R9.7, D-10) 참조.

흐름:
  1. ExportJob(status=NotStarted) → Running 갱신
  2. Power BI ExportTo API 호출 → powerbi_export_id 저장
  3. poll_until_done() 으로 Succeeded/Failed 대기
  4. 성공: download_export_file() → StorageService.save() → ExportJob 갱신(Succeeded)
  5. 실패: ExportJob.status=Failed + error_message

mock 모드: 외부 호출 없이 최소 PNG 파일로 성공 시뮬레이션.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from app.core.config import settings
from app.core.constants import ExportStatus
from app.core.errors import PowerBIError
from app.core.logging import get_logger
from app.db.redis import redis_client
from app.db.session import AsyncSessionLocal
from app.models.mail import ExportJob
from app.models.report import Report
from app.services.powerbi.export_service import (
    download_export_file,
    download_report_pbix,
    poll_until_done,
    start_export,
)
from app.services.powerbi.token_service import MockTokenService, TokenService
from app.services.storage_service import get_storage_service
from app.workers.async_runner import run_async
from app.workers.celery_app import celery_app

logger = get_logger(__name__)


def _safe_name_part(value: str) -> str:
    """파일명/저장 경로에 쓸 수 있게 구분자·제어문자를 정리한다.

    페이지 표시 이름은 사용자가 Power BI에서 자유롭게 지정하므로 `/`, `\\`, `:` 같은
    경로 구분자가 들어올 수 있다. 그대로 파일명에 넣으면 의도치 않은 하위 경로가
    만들어지거나 저장이 실패한다.
    """
    cleaned = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", value).strip(" .")
    return cleaned[:80] or "page"


def _storage_path(export_job_id: int, file_name: str) -> str:
    """저장소 상대 경로: export/{년}/{월}/{id}_{파일명}."""
    now = datetime.now(timezone.utc)
    return f"export/{now.year}/{now.month:02d}/{export_job_id}_{file_name}"


async def _store_and_finalize(export_job_id: int, file_result: Any) -> dict[str, Any]:
    """다운로드한 파일을 StorageService에 저장하고 ExportJob을 완료 처리한다.

    ExportTo(PDF/PPTX/PNG)와 원본 .pbix 다운로드가 공통으로 사용한다.
    """
    rel_path = _storage_path(export_job_id, file_result.file_name)
    storage = get_storage_service()
    try:
        stored = storage.save(rel_path, file_result.data, file_result.content_type)
    except Exception as exc:
        async with AsyncSessionLocal() as db:
            job = await db.scalar(select(ExportJob).where(ExportJob.id == export_job_id))
            if job:
                job.status = ExportStatus.FAILED
                job.error_message = f"파일 저장 오류: {exc}"
                await db.commit()
        return {"status": "Failed", "error": str(exc)}

    async with AsyncSessionLocal() as db:
        job = await db.scalar(select(ExportJob).where(ExportJob.id == export_job_id))
        if job:
            job.status = ExportStatus.SUCCEEDED
            job.file_path = stored.relative_path
            job.file_name = file_result.file_name
            job.mime_type = file_result.content_type
            await db.commit()

    logger.info("export_succeeded", export_job_id=export_job_id, file_path=stored.relative_path)
    return {
        "status": "Succeeded",
        "export_job_id": export_job_id,
        "file_path": stored.relative_path,
        "file_name": file_result.file_name,
    }


async def _run_export(export_job_id: int) -> dict[str, Any]:
    """Export 전체 흐름 실행 (async). 결과 dict 반환."""
    async with AsyncSessionLocal() as db:
        job = await db.scalar(
            select(ExportJob).where(ExportJob.id == export_job_id)
        )
        if job is None:
            logger.error("export_job_not_found", export_job_id=export_job_id)
            return {"status": "Failed", "error": "ExportJob을 찾을 수 없습니다."}

        report = await db.scalar(
            select(Report).where(Report.id == job.report_id)
        )
        if report is None:
            job.status = ExportStatus.FAILED
            job.error_message = "연결된 Report를 찾을 수 없습니다."
            await db.commit()
            return {"status": "Failed", "error": job.error_message}

        workspace_id: str = job.workspace_id or report.workspace_id
        powerbi_report_id: str = report.report_id
        export_format: str = job.export_format or "PDF"
        report_name: str = report.display_name or report.report_name or "report"
        # 페이지 단위 내보내기 옵션(직접 Export). 메일 발송 경로는 mail_job이 처리한다.
        page_name: str | None = job.page_name
        page_display_name: str | None = job.page_display_name
        bookmark_state: str | None = job.bookmark_state
        page_names: list[str] = [
            name for name in (job.page_names_csv or "").split(",") if name
        ]

        job.status = ExportStatus.RUNNING
        await db.commit()

    # 파일명: 페이지 1장이면 "레포트명_페이지명"으로 구분되게 한다.
    file_base_name = report_name
    if page_name and page_display_name:
        file_base_name = f"{report_name}_{_safe_name_part(page_display_name)}"

    # Token 획득
    if settings.APP_MODE == "mock":
        token_service = MockTokenService()
    else:
        token_service = TokenService(settings=settings, redis=redis_client)
    access_token = await token_service.get_token()

    # 원본 .pbix: ExportTo/폴링 없이 단일 GET(Export Report API)으로 받아 바로 저장.
    if export_format.upper() == "PBIX":
        try:
            file_result = await download_report_pbix(
                access_token, workspace_id, powerbi_report_id, report_name,
            )
        except (PowerBIError, Exception) as exc:
            async with AsyncSessionLocal() as db:
                job = await db.scalar(select(ExportJob).where(ExportJob.id == export_job_id))
                if job:
                    job.status = ExportStatus.FAILED
                    job.error_message = f"원본(.pbix) 다운로드 오류: {exc}"
                    await db.commit()
            return {"status": "Failed", "error": str(exc)}
        return await _store_and_finalize(export_job_id, file_result)

    # ExportTo 시작 (현재 페이지 1장 또는 지정 페이지 전체 + 요청자 화면 상태 반영)
    try:
        start_result = await start_export(
            access_token, workspace_id, powerbi_report_id, export_format,
            page_name=page_name,
            page_names=page_names or None,
            bookmark_state=bookmark_state,
        )
    except (PowerBIError, Exception) as exc:
        async with AsyncSessionLocal() as db:
            job = await db.scalar(select(ExportJob).where(ExportJob.id == export_job_id))
            if job:
                job.status = ExportStatus.FAILED
                job.error_message = f"Export 시작 오류: {exc}"
                await db.commit()
        return {"status": "Failed", "error": str(exc)}

    powerbi_export_id = start_result.export_id

    async with AsyncSessionLocal() as db:
        job = await db.scalar(select(ExportJob).where(ExportJob.id == export_job_id))
        if job:
            job.export_id = powerbi_export_id
            await db.commit()

    # 폴링
    try:
        poll_result = await poll_until_done(
            access_token, workspace_id, powerbi_report_id, powerbi_export_id,
            poll_interval_sec=settings.EXPORT_POLL_INTERVAL_SEC,
            timeout_sec=settings.EXPORT_POLL_TIMEOUT_SEC,
        )
    except (PowerBIError, Exception) as exc:
        async with AsyncSessionLocal() as db:
            job = await db.scalar(select(ExportJob).where(ExportJob.id == export_job_id))
            if job:
                job.status = ExportStatus.FAILED
                job.error_message = f"Export 폴링 오류: {exc}"
                await db.commit()
        return {"status": "Failed", "error": str(exc)}

    if poll_result.status == "Failed":
        async with AsyncSessionLocal() as db:
            job = await db.scalar(select(ExportJob).where(ExportJob.id == export_job_id))
            if job:
                job.status = ExportStatus.FAILED
                job.error_message = "Power BI Export가 실패 상태로 종료됐습니다."
                await db.commit()
        return {"status": "Failed", "error": "Power BI Export 실패"}

    # 파일 다운로드 + StorageService 저장
    try:
        file_result = await download_export_file(
            access_token, workspace_id, powerbi_report_id, powerbi_export_id,
            report_name=file_base_name, export_format=export_format,
        )
    except (PowerBIError, Exception) as exc:
        async with AsyncSessionLocal() as db:
            job = await db.scalar(select(ExportJob).where(ExportJob.id == export_job_id))
            if job:
                job.status = ExportStatus.FAILED
                job.error_message = f"파일 다운로드 오류: {exc}"
                await db.commit()
        return {"status": "Failed", "error": str(exc)}

    return await _store_and_finalize(export_job_id, file_result)


@celery_app.task(name="bip.export_poll")
def export_poll(export_job_id: int) -> dict[str, Any]:
    """Export 폴링 작업 진입점 (sync Celery task → 지속 루프 러너)."""
    return run_async(_run_export(export_job_id))
