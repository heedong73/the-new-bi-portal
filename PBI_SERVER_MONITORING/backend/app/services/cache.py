"""Redis response cache for the Refresh query endpoints.

Design reference: "Redis 키/TTL 규약" and "Redis 캐싱 전략".

| 용도 | 키 패턴 | TTL |
|---|---|---|
| Refresh timetable 응답 캐시 | ``prm:cache:refresh-timetable:{hash(query)}`` | ``CACHE_TTL_SECONDS`` (기본 60) |
| Refresh history 응답 캐시 (date 단위) | ``prm:cache:refresh-history:{date}`` | ``CACHE_TTL_SECONDS`` (기본 60) |

**Intent note (Requirement 11.2):** design.md phrases this as "PowerBI_Client가
외부 호출 결과를 캐싱". In the current architecture (stage 3.5) the read path
queries PostgreSQL directly rather than calling Power BI, so the natural and
equivalent thing to cache is the *response* of ``GET /api/refresh-history`` and
``GET /api/refresh-timetable`` — a ``list[RefreshRunOut]``. Caching the response
satisfies R11.2 ("두 엔드포인트 응답 캐싱") and the perf target (R20.2, cache hit
< 200ms) while keeping the DB read path unchanged.

**Serialization:** ``RefreshRunOut.model_dump(mode="json")`` produces a JSON-safe
``dict`` (``datetime`` -> ISO 8601 strings); a ``list[dict]`` is then
``json.dumps``-ed and stored with ``SET ... EX ttl``. On read, ``json.loads`` +
``RefreshRunOut.model_validate`` reconstructs the models.

**Graceful degradation:** Redis is a non-critical accelerator here. A transient
Redis failure (connection error, decode error) must never fail the request, so
both ``get_cached_runs`` and ``set_cached_runs`` swallow exceptions and log a
warning — the route then falls back to the DB query. ``invalidate_cache`` does
the same.

**Invalidation:** ``invalidate_cache`` removes every ``prm:cache:*`` key via
``SCAN`` + ``DELETE`` and is intended to be called after ``POST /api/collect-now``
(stage 5) so freshly collected data is not masked by a stale cached response.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date

from redis.asyncio import Redis

from app.core.logging import get_logger
from app.schemas.refresh import RefreshRunOut

logger = get_logger(__name__)

# Common prefix for every response-cache key (also the invalidation match).
CACHE_PREFIX = "prm:cache:"
_HISTORY_PREFIX = f"{CACHE_PREFIX}refresh-history:"
_TIMETABLE_PREFIX = f"{CACHE_PREFIX}refresh-timetable:"


def history_cache_key(target_date: date) -> str:
    """Build the ``prm:cache:refresh-history:{date}`` key for a given day.

    The date component is the ISO ``YYYY-MM-DD`` form of the requested
    ``APP_TIMEZONE`` day, matching the endpoint's ``date`` query parameter.
    """
    return f"{_HISTORY_PREFIX}{target_date.isoformat()}"


def timetable_cache_key(
    *,
    from_: str | None,
    to: str | None,
    status: str | None,
    report_id: str | None,
    dataset_id: str | None,
) -> str:
    """Build the ``prm:cache:refresh-timetable:{hash(query)}`` key.

    The five optional filter params are serialized in a stable, sorted order so
    that semantically identical requests map to the same key regardless of how
    the caller ordered the query string. The serialized payload is hashed with
    SHA-256 and truncated to 16 hex chars (collision-safe for this small,
    low-cardinality key space).
    """
    payload = {
        "from": from_,
        "to": to,
        "status": status,
        "reportId": report_id,
        "datasetId": dataset_id,
    }
    # ``sort_keys=True`` makes the serialization order-independent and stable.
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:16]
    return f"{_TIMETABLE_PREFIX}{digest}"


async def get_cached_runs(redis: Redis, key: str) -> list[RefreshRunOut] | None:
    """Return the cached ``RefreshRunOut`` list for ``key``, or ``None`` on miss.

    Returns ``None`` on a cache miss *and* on any Redis/decoding failure, so the
    caller transparently falls back to the DB query (graceful degradation).
    """
    try:
        raw = await redis.get(key)
    except Exception:  # noqa: BLE001 - cache must never break the request
        logger.warning("cache_get_failed", key=key, exc_info=True)
        return None

    if raw is None:
        return None

    try:
        items = json.loads(raw)
        return [RefreshRunOut.model_validate(item) for item in items]
    except Exception:  # noqa: BLE001 - corrupt/incompatible payload -> treat as miss
        logger.warning("cache_decode_failed", key=key, exc_info=True)
        return None


async def set_cached_runs(
    redis: Redis, key: str, runs: list[RefreshRunOut], ttl: int
) -> None:
    """Serialize ``runs`` to JSON and store under ``key`` with ``EX ttl``.

    ``RefreshRunOut.model_dump(mode="json")`` yields JSON-safe dicts (datetimes
    become ISO 8601 strings). Failures are swallowed and logged so a transient
    Redis outage never fails the request.
    """
    try:
        payload = json.dumps([run.model_dump(mode="json") for run in runs])
        await redis.set(key, payload, ex=ttl)
    except Exception:  # noqa: BLE001 - caching is best-effort
        logger.warning("cache_set_failed", key=key, exc_info=True)


async def invalidate_cache(redis: Redis, prefix: str = CACHE_PREFIX) -> int:
    """Delete every ``{prefix}*`` key (default ``prm:cache:*``); return count.

    Uses ``SCAN`` (via ``scan_iter``) to collect matching keys without blocking
    Redis, then ``DELETE``s them. Intended to be invoked after
    ``POST /api/collect-now`` (stage 5) so newly collected data is not masked by
    a stale cached response. Errors are swallowed and logged.
    """
    deleted = 0
    try:
        keys = [key async for key in redis.scan_iter(match=f"{prefix}*")]
        if keys:
            deleted = await redis.delete(*keys)
    except Exception:  # noqa: BLE001 - invalidation is best-effort
        logger.warning("cache_invalidate_failed", prefix=prefix, exc_info=True)
        return 0
    return deleted
