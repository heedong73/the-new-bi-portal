"""Celery collect task — ``prm.collect_workspace`` (lock → collect → release).

Design reference: "작업 정의", "Refresh_Collector 시퀀스", "Redis 분산 락".

This is the worker-side entry point that ``POST /api/collect-now`` (via
``services/collect_dispatch.enqueue_collect``) and Celery Beat (stage 6.2) both
trigger. Its fully-qualified path ``app.workers.tasks.collect.collect_workspace``
matches the lazy import in ``collect_dispatch`` and its task ``name`` is the
``prm.collect_workspace`` referenced by the Beat schedule.

Sync task, async body
----------------------
Celery tasks run synchronously on a worker thread/process, but every dependency
here (``redis.asyncio``, the async SQLAlchemy session, the async
``PowerBIClient``) is ``async``. So the task body is a thin sync wrapper that
runs the real work via ``asyncio.run(_collect(...))``, creating and tearing down
a fresh event loop per task invocation. All async resources (Redis client,
DB session) are created and closed inside that loop.

Flow (design "Refresh_Collector 시퀀스")
---------------------------------------
1. ``acquire_collect_lock`` — ``SET NX EX`` on ``prm:lock:collect:{ws}``. If the
   lock is already held, another collection is in flight: skip and return
   ``{"status": "skipped-locked"}`` (Requirement 4.8). This is a normal outcome,
   not an error.
2. On acquisition, build a ``PowerBIClient`` (mock/live by ``APP_MODE``), open an
   async DB session, run ``collector.collect_workspace`` (idempotent upserts;
   in-progress → finished transitions handled by the upsert, Requirement 4.5,
   4.6), then ``commit``.
3. ``finally`` — always ``release_collect_lock`` with the fencing token so the
   lock is freed even on error. After a successful collect, ``invalidate_cache``
   clears ``prm:cache:*`` so freshly collected data is not masked by a stale
   cached response (links to stage 4.4 caching).

Lock TTL note (Requirement 20.3): the 60s lock TTL equals the worker collection
SLA. If a collection runs long and the TTL expires, another worker may enter —
but because every write is an idempotent ``ON CONFLICT DO UPDATE`` upsert, an
overlap cannot corrupt data; at worst the same rows are written twice.

Retries (design "작업 정의"): ``autoretry_for=(httpx.HTTPError,)`` with
``retry_backoff=True`` and ``max_retries=3`` so transient Power BI / Azure AD
transport errors are retried with exponential backoff. The lock is released in
the ``finally`` before the retry is raised, so a retry re-acquires cleanly.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from redis.asyncio import Redis, from_url as redis_from_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.services import cache
from app.services.powerbi import collector
from app.services.powerbi.lock import acquire_collect_lock, release_collect_lock
from app.services.powerbi.client import PowerBIClient
from app.services.powerbi.live_client import LivePowerBIClient
from app.services.powerbi.mock_client import MockPowerBIClient
from app.services.powerbi.token_service import (
    MockTokenService,
    TokenService,
    TokenServiceProtocol,
)
from app.workers.celery_app import celery_app

logger = get_logger(__name__)


def _build_token_service(settings: Settings, redis: Any) -> TokenServiceProtocol:
    """Build a ``TokenService`` by ``APP_MODE`` (worker-side, no FastAPI Depends).

    Mirrors ``core.deps.get_token_service`` but without the dependency-injection
    machinery, since Celery workers cannot use FastAPI ``Depends``:

    - ``mock`` -> ``MockTokenService`` (zero Azure AD calls, R2.2).
    - ``live`` -> ``TokenService`` (Azure AD client_credentials + Redis cache).
    """
    if settings.APP_MODE == "mock":
        return MockTokenService()
    return TokenService(settings=settings, redis=redis)


def _build_powerbi_client(settings: Settings, redis: Any) -> PowerBIClient:
    """Build a ``PowerBIClient`` by ``APP_MODE`` (worker-side factory).

    The FastAPI ``get_powerbi_client`` dependency cannot be used from a Celery
    worker (no request scope / ``Depends`` chain), so this small factory applies
    the same ``APP_MODE`` branch directly:

    - ``mock`` -> ``MockPowerBIClient`` (generated fixtures, no external calls).
    - ``live`` -> ``LivePowerBIClient`` backed by a worker-built ``TokenService``.
    """
    if settings.APP_MODE == "mock":
        return MockPowerBIClient()
    token_service = _build_token_service(settings, redis)
    return LivePowerBIClient(settings=settings, token_service=token_service)


async def _collect(workspace_id: str) -> dict[str, Any]:
    """Async collection body: acquire lock → collect → release + invalidate cache.

    **Per-task async resources (event-loop safety).** A Celery task runs the
    async body via ``asyncio.run``, which creates a *fresh event loop per
    invocation* and closes it on return. ``redis.asyncio`` clients and the
    SQLAlchemy async engine bind their connection pools to the event loop that
    first uses them, so reusing the process-wide cached singletons
    (``get_redis_client`` / ``get_engine``) across tasks would touch a *closed*
    loop on the next run and raise ``RuntimeError: Event loop is closed``.

    To keep every async resource's lifetime aligned with this task's loop, we
    build a **new** Redis client and a **new** async engine here and dispose
    both in ``finally``. The FastAPI request path keeps using the shared
    singletons (a single long-lived loop), which is unaffected.

    Returns the collector's counts dict on success, or
    ``{"status": "skipped-locked"}`` when the lock is already held (R4.8).
    """
    settings = get_settings()
    # New Redis client bound to *this* task's event loop (closed in finally).
    redis: Redis = redis_from_url(settings.REDIS_URL, decode_responses=True)

    lock_value = await acquire_collect_lock(redis, workspace_id)
    if lock_value is None:
        # Another collection is already running for this workspace (R4.8).
        logger.info("collect_skipped_locked", workspace_id=workspace_id)
        await redis.aclose()
        return {"status": "skipped-locked"}

    # New async engine + sessionmaker bound to this task's loop (disposed below).
    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    sessionmaker = async_sessionmaker(bind=engine, expire_on_commit=False)
    try:
        client = _build_powerbi_client(settings, redis)
        async with sessionmaker() as session:
            counts = await collector.collect_workspace(session, client, workspace_id)
            await session.commit()

        # Drop stale cached responses so the new data is visible immediately.
        await cache.invalidate_cache(redis)
        logger.info("collect_completed", workspace_id=workspace_id, **counts)
        return counts
    finally:
        # Always release the lock (fencing token) — even on error / retry —
        # then dispose this task's async resources within the same loop.
        await release_collect_lock(redis, workspace_id, lock_value)
        await engine.dispose()
        await redis.aclose()


@celery_app.task(
    bind=True,
    name="prm.collect_workspace",
    autoretry_for=(httpx.HTTPError,),
    retry_backoff=True,
    max_retries=3,
)
def collect_workspace(self, workspace_id: str) -> dict[str, Any]:
    """Celery entry point for a single-workspace collection (Requirement 10.1).

    Synchronous task that runs the async :func:`_collect` body via
    ``asyncio.run`` (fresh event loop per invocation). Returns the collector's
    counts dict, or ``{"status": "skipped-locked"}`` if a collection for this
    workspace is already running (Requirement 4.8).

    Transient ``httpx.HTTPError``s are retried automatically (exponential
    backoff, up to 3 times) per the ``@task`` decorator config.
    """
    return asyncio.run(_collect(workspace_id))
