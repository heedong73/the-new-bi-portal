"""Celery Beat 예약 실행 경로 heartbeat.

Beat가 이 작업을 주기적으로 큐에 넣고 Worker가 Redis 시각을 갱신한다. 따라서 키가
신선하면 Beat → Redis broker → Worker 경로가 끝까지 동작했다는 뜻이다.
"""
from __future__ import annotations

from datetime import datetime, timezone

import redis

from app.core.config import settings
from app.services.monitoring_service import (
    SCHEDULER_HEARTBEAT_KEY,
    SCHEDULER_HEARTBEAT_TTL_SECONDS,
)
from app.workers.celery_app import celery_app


@celery_app.task(name="bip.scheduler_heartbeat")
def scheduler_heartbeat() -> dict[str, str]:
    checked_at = datetime.now(timezone.utc).isoformat()
    client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        client.set(
            SCHEDULER_HEARTBEAT_KEY,
            checked_at,
            ex=SCHEDULER_HEARTBEAT_TTL_SECONDS,
        )
    finally:
        client.close()
    return {"status": "ok", "checked_at": checked_at}
