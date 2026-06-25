"""간단한 Redis JSON 응답 캐시 (best-effort).

집계 통계처럼 비용이 큰 조회 결과를 짧은 TTL(기본 60s)로 캐시한다.
Redis 장애가 요청을 막지 않도록 get/set 모두 예외를 삼킨다(PRM cache 패턴 계승).
"""
from __future__ import annotations

import json
from typing import Any

from redis.asyncio import Redis

from app.core.logging import get_logger

logger = get_logger(__name__)


async def cache_get_json(redis: Redis, key: str) -> Any | None:
    """캐시에서 JSON 값을 읽는다. 미스/오류 시 None."""
    try:
        raw = await redis.get(key)
    except Exception:  # noqa: BLE001 - 캐시는 요청을 막지 않는다
        logger.warning("cache_get_failed", key=key, exc_info=True)
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return None


async def cache_set_json(redis: Redis, key: str, value: Any, ttl_sec: int) -> None:
    """JSON 직렬화하여 TTL과 함께 저장. 오류는 무시(best-effort)."""
    try:
        await redis.set(key, json.dumps(value, default=str), ex=ttl_sec)
    except Exception:  # noqa: BLE001 - 캐시는 best-effort
        logger.warning("cache_set_failed", key=key, exc_info=True)
