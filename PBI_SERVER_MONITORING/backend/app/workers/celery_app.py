"""Celery application instance (broker + result backend on Redis).

Design reference: "Worker / Scheduler 설계", "작업 정의", "Redis 키/TTL 규약".

The PRM worker stack reuses the single Redis instance for everything:

- **broker**: ``settings.REDIS_URL`` — where ``POST /api/collect-now`` and
  Celery Beat enqueue ``prm.collect_workspace`` jobs.
- **result backend**: ``settings.REDIS_URL`` — stores ``celery-task-meta-*``
  entries so ``POST /api/collect-now`` can return a real ``taskId``
  (Requirement 10.3).

``include=["app.workers.tasks.collect"]`` makes the worker import the collect
task module on startup so the ``prm.collect_workspace`` task is registered. The
task's fully-qualified name (``app.workers.tasks.collect.collect_workspace``)
matches the lazy import in ``services/collect_dispatch.enqueue_collect`` so the
stage-5 route wires straight through to this task with no further change.

Compose runs this app two ways (design "Docker Compose 구성"):

- worker:    ``celery -A app.workers.celery_app worker --loglevel=info``
- scheduler: ``celery -A app.workers.celery_app beat   --loglevel=info``

Serialization is pinned to JSON (no pickle) for safety, and the timezone is
bound to ``APP_TIMEZONE`` so Beat cron schedules (stage 6.2) fire on the
operator's local clock.
"""

from __future__ import annotations

from celery import Celery

from app.core.config import get_settings
from app.workers.beat_schedule import beat_schedule

settings = get_settings()

# Single Celery app named "prm"; Redis is broker AND result backend so the one
# Redis service covers queue, results, token cache, response cache, and lock.
celery_app = Celery(
    "prm",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.workers.tasks.collect"],
)

celery_app.conf.update(
    # JSON only — never unpickle task payloads (defense-in-depth).
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    # Bind Beat/cron scheduling to the operator's timezone (APP_TIMEZONE).
    timezone=settings.APP_TIMEZONE,
    enable_utc=True,
    # Keep task results long enough for POST /api/collect-now to read taskId.
    result_expires=86400,
    # Celery Beat schedule (stage 6.2): periodic prm.collect_workspace trigger
    # every COLLECT_INTERVAL_MINUTES (1 or 5) with POWERBI_WORKSPACE_ID arg.
    # Defined in app.workers.beat_schedule (one-directional import to avoid a
    # circular dependency: celery_app -> beat_schedule, never the reverse).
    beat_schedule=beat_schedule,
)
