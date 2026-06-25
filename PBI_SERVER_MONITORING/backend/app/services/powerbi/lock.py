"""Redis distributed lock for Workspace collection (single-flight collect).

Design reference: "Redis 분산 락 (``services/powerbi/lock.py``)" and the
Refresh_Collector sequence (``SET NX EX prm:lock:collect:{ws_id} 60s`` ->
collect -> ``DEL``). Validates Requirements 4.8 and 11.3: while a collection
job for a given Workspace is already running, a duplicate run must be blocked
via a Redis-based distributed lock (``SET NX EX``).

The lock is a single string key whose value is a per-acquisition UUID. This
*fencing token* is what makes release safe: only the caller that currently
owns the lock (whose ``lock_value`` still matches the stored value) may delete
it. Release is performed with a Lua script so the get-compare-delete is atomic
on the Redis server, which is what guarantees the mutual-exclusion property
(design Property 8): a stale owner whose TTL already expired (and whose key was
re-acquired by someone else) can never delete the new owner's lock.

Key/TTL convention (design "Redis 키/TTL 규약"):

| 용도 | 키 | TTL |
|---|---|---|
| Workspace 수집 락 | ``prm:lock:collect:{workspace_id}`` | 60s |

The 60s default TTL matches the Worker collection SLA (R20.3) and acts as a
safety net: if a worker crashes mid-collection without releasing the lock, the
key expires on its own so the next cycle is not blocked forever.

Built on ``redis.asyncio``; the client is injected by the caller (the Celery
collect task / ``POST /api/collect-now`` route, stage 5.3 / 6.1) following the
same dependency-injection style as ``services/cache.py``.
"""

from __future__ import annotations

import uuid

from redis.asyncio import Redis

from app.core.logging import get_logger

logger = get_logger(__name__)

# Prefix for every Workspace collection lock key (design "Redis 키/TTL 규약").
_LOCK_PREFIX = "prm:lock:collect:"

# Default lock TTL in seconds. Matches the 60s worker SLA (R20.3) and the
# design sequence (``SET NX EX ... 60s``); also bounds how long a crashed
# worker can hold the lock before it auto-expires.
DEFAULT_LOCK_TTL_SEC = 60

# Atomic compare-and-delete: only delete the key if its current value still
# equals the value we wrote when we acquired the lock. Copied verbatim from
# design.md so release can never delete a lock owned by another caller.
_RELEASE_LUA = (
    "if redis.call('get', KEYS[1]) == ARGV[1] "
    "then return redis.call('del', KEYS[1]) "
    "else return 0 end"
)


def collect_lock_key(workspace_id: str) -> str:
    """Build the ``prm:lock:collect:{workspace_id}`` lock key."""
    return f"{_LOCK_PREFIX}{workspace_id}"


async def acquire_collect_lock(
    redis: Redis, workspace_id: str, ttl_sec: int = DEFAULT_LOCK_TTL_SEC
) -> str | None:
    """Try to acquire the Workspace collection lock.

    Performs ``SET key value NX EX ttl_sec``: the write succeeds only if the
    key does not already exist (``NX``), and the key is given a ``ttl_sec``
    expiry (``EX``) so the lock is self-healing if the owner crashes.

    Returns the generated ``lock_value`` (a UUID4 string) on success — the
    caller must pass this exact value back to :func:`release_collect_lock`. If
    the lock is already held (the ``SET`` returns falsy), returns ``None`` and
    the caller should treat the collection as already running (Requirement 4.8,
    11.3).
    """
    key = collect_lock_key(workspace_id)
    lock_value = str(uuid.uuid4())
    # ``nx=True`` -> set only if absent; ``ex=ttl_sec`` -> expire after TTL.
    acquired = await redis.set(key, lock_value, nx=True, ex=ttl_sec)
    if acquired:
        logger.info("collect_lock_acquired", workspace_id=workspace_id, ttl_sec=ttl_sec)
        return lock_value
    logger.info("collect_lock_busy", workspace_id=workspace_id)
    return None


async def release_collect_lock(
    redis: Redis, workspace_id: str, lock_value: str
) -> None:
    """Release the Workspace collection lock iff this caller still owns it.

    Runs the atomic compare-and-delete Lua script: the key is deleted only when
    its current value equals ``lock_value`` (the token returned by
    :func:`acquire_collect_lock`). A caller that never held the lock, or whose
    lock already expired and was re-acquired by someone else, deletes nothing —
    this is what preserves mutual exclusion (design Property 8).

    The release is best-effort: a transient Redis failure is logged and
    swallowed rather than raised, since the lock's TTL will expire the key
    regardless. ``EVAL`` is called with ``numkeys=1``: the key is a ``KEYS``
    arg and the expected value is an ``ARGV`` arg.
    """
    key = collect_lock_key(workspace_id)
    try:
        deleted = await redis.eval(_RELEASE_LUA, 1, key, lock_value)
    except Exception:  # noqa: BLE001 - release is best-effort; TTL is the backstop
        logger.warning(
            "collect_lock_release_failed", workspace_id=workspace_id, exc_info=True
        )
        return
    if deleted:
        logger.info("collect_lock_released", workspace_id=workspace_id)
    else:
        # Either we did not own the lock or it already expired — not an error.
        logger.info("collect_lock_release_noop", workspace_id=workspace_id)


async def is_collect_locked(redis: Redis, workspace_id: str) -> bool:
    """Return whether a collection lock currently exists for ``workspace_id``.

    Used by ``POST /api/collect-now`` (stage 5.3) to report
    ``{status: "already-running"}`` without attempting to acquire the lock.
    This is a point-in-time check; the authoritative single-flight guarantee
    still comes from the atomic ``SET NX`` in :func:`acquire_collect_lock`.
    """
    return bool(await redis.exists(collect_lock_key(workspace_id)))
