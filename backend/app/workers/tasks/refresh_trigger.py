"""수동 새로고침 Worker task — Power BI dataset refresh 트리거.

design.md "수동 새로고침 설계"(R13, R37) 참조.
분산 락으로 동일 dataset 중복 트리거 차단, mock 모드는 시뮬레이션.

**Enhanced refresh 전환**: POST 본문에 ``type`` 파라미터를 포함해 "enhanced
refresh"로 트리거한다(빈 본문의 "standard refresh"는 Power BI가 취소를 지원하지
않음). 응답 Location 헤더/x-ms-request-id의 requestId를 이 새로고침의
refresh_id로 Redis에 저장해, 취소 API(datasets.py cancel_refresh)가 진행 중인
refresh를 식별할 수 있게 한다.
"""
from __future__ import annotations

from typing import Any

import httpx
import redis.asyncio as aioredis

from app.core.config import settings
from app.services.powerbi.lock import acquire_lock, job_lock_key, release_lock
from app.services.powerbi.mock_client import register_mock_refresh
from app.services.powerbi.token_service import TokenService
from app.workers.async_runner import run_async
from app.workers.celery_app import celery_app

_REFRESH_JOB_TYPE = "refresh"

# 진행 중인 refresh의 requestId를 담는 Redis 키. 취소 엔드포인트가 조회한다.
# Enhanced refresh의 최대 총 실행 시간(24시간)에 맞춰 추적 정보를 유지한다.
REFRESH_ID_TTL_SEC = 24 * 60 * 60
# POST 수락 직후 Power BI 이력에 requestId가 나타나기까지 허용할 전파 유예 시간.
REFRESH_HISTORY_GRACE_SEC = 5 * 60


def refresh_id_key(dataset_id: str) -> str:
    """진행 중인 refresh의 requestId를 저장하는 Redis 키."""
    return f"bip:refreshid:{dataset_id}"


async def _trigger(
    workspace_id: str,
    dataset_id: str,
    lock_value: str | None = None,
) -> dict[str, Any]:
    """예약 락 확인 → Power BI enhanced refresh POST → requestId 저장 → 락 해제.

    API가 enqueue 전에 획득한 ``lock_value``를 전달하면 같은 소유권 토큰을 이어받아
    사용한다. 워커가 지연되어 락이 만료·교체된 경우에는 요청을 보내지 않아, 늦게 도착한
    작업이 새 실행과 겹치는 것을 막는다. 직접 호출되는 경우에는 워커가 락을 획득한다.
    """
    redis = aioredis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
    try:
        owned_lock_value = lock_value
        if owned_lock_value is not None:
            current_lock_value = await redis.get(job_lock_key(_REFRESH_JOB_TYPE, dataset_id))
            if current_lock_value != owned_lock_value:
                return {"status": "reservation-expired", "dataset_id": dataset_id}
        else:
            owned_lock_value = await acquire_lock(redis, _REFRESH_JOB_TYPE, dataset_id)
            if owned_lock_value is None:
                return {"status": "already-running", "dataset_id": dataset_id}

        try:
            if settings.APP_MODE == "mock":
                request_id = f"mock-{owned_lock_value}"
                await redis.set(
                    refresh_id_key(dataset_id), request_id, ex=REFRESH_ID_TTL_SEC
                )
                # Register a stateful simulated refresh so MockPowerBIClient's
                # list_refreshes/cancel_refresh (used by live-status + cancel
                # routes) observe a real "Unknown -> Completed/Cancelled"
                # transition, letting the stop button be exercised in mock mode.
                await register_mock_refresh(redis, dataset_id, request_id)
                await redis.delete(f"bip:livestatus:{workspace_id}:{dataset_id}")
                return {
                    "status": "triggered",
                    "dataset_id": dataset_id,
                    "mode": "mock",
                    "request_id": request_id,
                }

            token_service = TokenService(settings=settings, redis=redis)
            access_token = await token_service.get_token()
            url = (
                f"{settings.POWERBI_API_BASE_URL}/groups/{workspace_id}"
                f"/datasets/{dataset_id}/refreshes"
            )
            async with httpx.AsyncClient(verify=settings.POWERBI_VERIFY_SSL) as client:
                resp = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {access_token}"},
                    # Full은 수동 새로고침처럼 원본 데이터를 다시 처리한다. 파라미터를
                    # 지정했으므로 취소 가능한 enhanced refresh로 생성된다.
                    json={"type": "Full"},
                )
            if resp.status_code >= 400:
                return {
                    "status": "failed",
                    "dataset_id": dataset_id,
                    "http_status": resp.status_code,
                }
            request_id = resp.headers.get("x-ms-request-id") or resp.headers.get("requestId")
            if not request_id:
                location = resp.headers.get("Location")
                if location:
                    request_id = location.rstrip("/").rsplit("/", 1)[-1]
            if request_id:
                await redis.set(
                    refresh_id_key(dataset_id), request_id, ex=REFRESH_ID_TTL_SEC
                )
                # 트리거 직후 route/UI가 이전 20초 캐시를 보지 않도록 즉시 무효화한다.
                await redis.delete(f"bip:livestatus:{workspace_id}:{dataset_id}")
            return {"status": "triggered", "dataset_id": dataset_id, "request_id": request_id}
        finally:
            await release_lock(
                redis, _REFRESH_JOB_TYPE, dataset_id, owned_lock_value
            )
    finally:
        await redis.aclose()

@celery_app.task(name="bip.refresh_trigger")
def refresh_trigger(
    workspace_id: str,
    dataset_id: str,
    user_id: int | None = None,
    lock_value: str | None = None,
) -> dict[str, Any]:
    """수동 새로고침 작업 진입점 (sync task → 지속 루프 러너)."""
    return run_async(_trigger(workspace_id, dataset_id, lock_value))
