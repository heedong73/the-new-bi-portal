"""운영 상태 모니터링 집계 (T-34).

R36: DB/Redis/Worker 가용성 + 최근 동기화/메일/Export 작업 결과 + 실패 가시화.
Celery worker ping 은 동기 호출이라 asyncio.to_thread 로 감싸 이벤트 루프를 막지 않는다.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import ExportStatus, MailJobStatus, RefreshStatus
from app.core.logging import get_logger
from app.models.mail import ExportJob, MailJob
from app.models.refresh import RefreshRun
from app.workers.celery_app import celery_app

logger = get_logger(__name__)

_RECENT_LIMIT = 5
_FAILURE_WINDOW_HOURS = 24


async def ping_workers(timeout_sec: float = 1.0) -> tuple[bool, int]:
    """Celery worker 가용성 확인. (ok, worker_count) 반환.

    control.ping 은 블로킹이므로 스레드로 분리하고, 브로커 장애 등 예외는 unavailable 로 처리.
    """
    def _ping() -> list:
        try:
            return celery_app.control.ping(timeout=timeout_sec) or []
        except Exception:  # noqa: BLE001 - 브로커 장애 시 unavailable
            return []

    try:
        replies = await asyncio.wait_for(
            asyncio.to_thread(_ping), timeout=timeout_sec + 2.0
        )
    except (asyncio.TimeoutError, Exception):  # noqa: BLE001
        logger.warning("worker_ping_failed", exc_info=True)
        return False, 0
    return (len(replies) > 0), len(replies)


async def recent_jobs(db: AsyncSession) -> dict[str, list[dict[str, Any]]]:
    """최근 동기화(refresh)/메일/Export 작업 결과 (각 최신 N건)."""
    refresh_rows = (await db.execute(
        select(RefreshRun)
        .order_by(RefreshRun.start_time_utc.desc().nullslast(), RefreshRun.id.desc())
        .limit(_RECENT_LIMIT)
    )).scalars().all()
    mail_rows = (await db.execute(
        select(MailJob).order_by(MailJob.id.desc()).limit(_RECENT_LIMIT)
    )).scalars().all()
    export_rows = (await db.execute(
        select(ExportJob).order_by(ExportJob.id.desc()).limit(_RECENT_LIMIT)
    )).scalars().all()

    return {
        "refresh": [
            {
                "id": r.id, "dataset_id": r.dataset_id, "status": r.status,
                "start_time_utc": r.start_time_utc, "error_message": r.error_message,
            }
            for r in refresh_rows
        ],
        "mail": [
            {
                "id": m.id, "mail_schedule_id": m.mail_schedule_id, "status": m.status,
                "started_at": m.started_at, "finished_at": m.finished_at,
                "failure_reason": m.failure_reason,
            }
            for m in mail_rows
        ],
        "export": [
            {
                "id": e.id, "mail_job_id": e.mail_job_id, "page_name": e.page_name,
                "status": e.status, "error_message": e.error_message,
            }
            for e in export_rows
        ],
    }


async def recent_failures(db: AsyncSession) -> dict[str, int]:
    """최근 24시간 내 실패한 정기 작업 수 (R36.3)."""
    naive_cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
        hours=_FAILURE_WINDOW_HOURS
    )
    aware_cutoff = datetime.now(timezone.utc) - timedelta(hours=_FAILURE_WINDOW_HOURS)

    refresh_failed = int(await db.scalar(
        select(func.count()).select_from(RefreshRun).where(
            RefreshRun.status == RefreshStatus.FAILED,
            RefreshRun.start_time_utc >= aware_cutoff,
        )
    ) or 0)
    mail_failed = int(await db.scalar(
        select(func.count()).select_from(MailJob).where(
            MailJob.status == MailJobStatus.FAILED,
            MailJob.started_at >= naive_cutoff,
        )
    ) or 0)
    export_failed = int(await db.scalar(
        select(func.count()).select_from(ExportJob).where(
            ExportJob.status == ExportStatus.FAILED,
            ExportJob.created_at >= naive_cutoff,
        )
    ) or 0)

    return {
        "refresh": refresh_failed,
        "mail": mail_failed,
        "export": export_failed,
    }
