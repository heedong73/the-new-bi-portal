"""수동 새로고침 Worker task — Power BI dataset refresh 트리거.

design.md "수동 새로고침 설계"(R13, R37) 참조.
분산 락으로 동일 dataset 중복 트리거 차단, mock 모드는 시뮬레이션.
"""
from __future__ import annotations

import asyncio
from typing import Any

import httpx
import redis.asyncio as aioredis

from app.core.config import settings
from app.services.powerbi.lock import acquire_lock, release_lock
from app.services.powerbi.token_service import TokenService, MockTokenService
from app.workers.async_runner import run_async
from app.workers.celery_app import celery_app

_REFRESH_JOB_TYPE = "refresh"

async def _trigger(workspace_id: str, dataset_id: str) -> dict[str, Any]:
    """락 획득 → Power BI refresh POST → 락 해제.

    워커는 asyncio.run()으로 매 호출 새 이벤트 루프를 쓰므로, 전역 redis_client(이전 루프
    바인딩) 재사용 시 'Event loop is closed'가 발생한다. 현재 루프 전용 redis를 새로 만든다.
    """
    redis = aioredis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
    try:
        lock_value = await acquire_lock(redis, _REFRESH_JOB_TYPE, dataset_id)
        if lock_value is None:
            return {"status": "already-running", "dataset_id": dataset_id}

        try:
            if settings.APP_MODE == "mock":
                return {"status": "triggered", "dataset_id": dataset_id, "mode": "mock"}

            token_service = TokenService(settings=settings, redis=redis)
            access_token = await token_service.get_token()
            url = (
                f"{settings.POWERBI_API_BASE_URL}/groups/{workspace_id}"
                f"/datasets/{dataset_id}/refreshes"
            )
            async with httpx.AsyncClient(verify=settings.POWERBI_VERIFY_SSL) as client:
                resp = await client.post(
                    url, headers={"Authorization": f"Bearer {access_token}"}
                )
            if resp.status_code >= 400:
                return {"status": "failed", "dataset_id": dataset_id,
                        "http_status": resp.status_code}
            return {"status": "triggered", "dataset_id": dataset_id}
        finally:
            await release_lock(redis, _REFRESH_JOB_TYPE, dataset_id, lock_value)
    finally:
        await redis.aclose()

@celery_app.task(name="bip.refresh_trigger")
def refresh_trigger(workspace_id: str, dataset_id: str, user_id: int | None = None) -> dict[str, Any]:
    """수동 새로고침 작업 진입점 (sync task → 지속 루프 러너)."""
    return run_async(_trigger(workspace_id, dataset_id))
