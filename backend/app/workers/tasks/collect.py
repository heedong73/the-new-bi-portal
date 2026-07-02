"""Refresh History 수집 Task — Celery Beat 주기 + collect-now 트리거.

PRM tasks/collect.py를 우리 구조에 맞게 조정.
분산 락(collect lock)으로 동일 workspace 중복 수집 차단.
"""
from __future__ import annotations

import asyncio
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from app.db.redis import redis_client
from app.db.session import AsyncSessionLocal
from app.services.powerbi.collector import collect_workspace
from app.services.powerbi.lock import acquire_collect_lock, release_collect_lock
from app.services.powerbi.mock_client import MockPowerBIClient
from app.workers.async_runner import run_async
from app.workers.celery_app import celery_app

logger = get_logger(__name__)

async def _run_collect(workspace_id: str) -> dict[str, Any]:
    lock_value = await acquire_collect_lock(redis_client, workspace_id)
    if lock_value is None:
        logger.info("collect_already_running", workspace_id=workspace_id)
        return {"status": "already-running", "workspace_id": workspace_id}

    try:
        if settings.APP_MODE == "mock":
            client = MockPowerBIClient()
        else:
            from app.services.powerbi.live_client import LivePowerBIClient
            from app.services.powerbi.token_service import TokenService
            token_service = TokenService(settings=settings, redis=redis_client)
            client = LivePowerBIClient(settings=settings, token_service=token_service)

        async with AsyncSessionLocal() as db:
            counts = await collect_workspace(db, client, workspace_id)
            await db.commit()

        logger.info("collect_done", workspace_id=workspace_id, **counts)
        return {"status": "ok", "workspace_id": workspace_id, **counts}
    except Exception as exc:
        logger.error("collect_failed", workspace_id=workspace_id, error=str(exc))
        return {"status": "failed", "workspace_id": workspace_id, "error": str(exc)}
    finally:
        await release_collect_lock(redis_client, workspace_id, lock_value)

@celery_app.task(name="bip.collect_workspace")
def collect_workspace_task(workspace_id: str) -> dict[str, Any]:
    """Workspace 수집 Celery task (sync → 지속 루프 러너)."""
    return run_async(_run_collect(workspace_id))
