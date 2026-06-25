"""Async Redis client provider.

Design reference: "Backend 모듈 구조" (``db/redis.py``) and "Redis 키/TTL 규약".

Built on ``redis.asyncio`` (the modern async client bundled with
``redis>=5``; the legacy ``aioredis`` package is merged into it). The client is
created lazily from ``Settings.REDIS_URL`` and cached for the process so token
caching, response caching, and the distributed collect lock all share one
connection pool.
"""

from __future__ import annotations

from functools import lru_cache

from redis.asyncio import Redis, from_url

from app.core.config import get_settings


@lru_cache
def get_redis_client() -> Redis:
    """Return a process-wide async Redis client bound to ``REDIS_URL``.

    ``decode_responses=True`` returns ``str`` values (tokens, lock UUIDs,
    cached JSON) rather than ``bytes``, which is what every caller in this
    codebase expects.
    """
    settings = get_settings()
    return from_url(settings.REDIS_URL, decode_responses=True)
