"""운영 장애 알림 주기 점검.

Beat가 주기적으로 호출한다. API 화면과 같은 판정(monitoring_service.collect_status)을
사용해, 화면에서 장애로 보이는 것과 알림 기준이 어긋나지 않게 한다.
"""
from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.db.redis import redis_client
from app.db.session import AsyncSessionLocal
from app.services import monitoring_service, ops_alert_service
from app.workers.async_runner import run_async
from app.workers.celery_app import celery_app

logger = get_logger(__name__)


async def _run() -> dict[str, Any]:
    async with AsyncSessionLocal() as db:
        status = await monitoring_service.collect_status(
            db, redis_client, include_recent_jobs=False,
        )
    result = await ops_alert_service.process_alerts(redis_client, status)
    return {"overall_status": status["overall_status"], **result}


@celery_app.task(name="bip.ops_alert_check")
def ops_alert_check() -> dict[str, Any]:
    """구성요소 장애를 점검하고 필요 시 운영자에게 메일로 알린다."""
    try:
        return run_async(_run())
    except Exception as exc:  # noqa: BLE001 - 점검 실패가 다른 주기 작업을 막지 않는다
        logger.warning("ops_alert_check_failed", error=str(exc))
        return {"status": "failed", "error": str(exc)}
