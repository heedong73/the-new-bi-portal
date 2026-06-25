"""보존 정리 작업 (T-43, R31).

설정 기반 보존기간(UTC 기준)을 넘긴 데이터를 정리한다.
- 레포트 이미지: IMAGE_RETENTION_DAYS 초과분 → 저장소 파일 삭제 + Report_Image_Path 행 삭제
- 감사 로그: AUDIT_RETENTION_DAYS 초과분 → audit_logs 행 삭제 (원장 단일 진실 유지)

Celery Beat 가 하루 1회 호출한다.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select

from app.core.config import settings
from app.core.logging import get_logger
from app.db.session import AsyncSessionLocal
from app.models.log import AuditLog
from app.models.mail import ReportImagePath
from app.services.storage_service import get_storage_service
from app.workers.celery_app import celery_app

logger = get_logger(__name__)


def _naive_utc_cutoff(days: int) -> datetime:
    """현재로부터 days 일 이전의 naive UTC 시각."""
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)


async def _cleanup_images(days: int) -> int:
    """보존기간 초과 이미지의 저장소 파일 + DB 행 삭제. 삭제 건수 반환."""
    cutoff = _naive_utc_cutoff(days)
    storage = get_storage_service()
    deleted = 0
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(ReportImagePath).where(ReportImagePath.created_at < cutoff)
            )
        ).scalars().all()
        for row in rows:
            try:
                storage.delete(row.image_path)
            except Exception:  # noqa: BLE001 - 파일 삭제 실패해도 DB 정리는 진행
                logger.warning("retention_image_file_delete_failed", path=row.image_path)
            await db.delete(row)
            deleted += 1
        await db.commit()
    logger.info("retention_images_cleaned", deleted=deleted, cutoff=str(cutoff))
    return deleted


async def _cleanup_audit_logs(days: int) -> int:
    """보존기간 초과 감사 로그 삭제. 삭제 건수 반환."""
    cutoff = _naive_utc_cutoff(days)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            delete(AuditLog).where(AuditLog.occurred_at_utc < cutoff)
        )
        await db.commit()
    deleted = result.rowcount or 0
    logger.info("retention_audit_cleaned", deleted=deleted, cutoff=str(cutoff))
    return deleted


async def _run_retention() -> dict[str, Any]:
    images = await _cleanup_images(settings.IMAGE_RETENTION_DAYS)
    audits = await _cleanup_audit_logs(settings.AUDIT_RETENTION_DAYS)
    return {"images_deleted": images, "audit_deleted": audits}


@celery_app.task(name="bip.retention_cleanup")
def retention_cleanup() -> dict[str, Any]:
    """Beat 진입점: 이미지/감사 로그 보존 정리."""
    return asyncio.run(_run_retention())
