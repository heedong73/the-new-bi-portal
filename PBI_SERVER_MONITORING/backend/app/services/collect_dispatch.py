"""Collect-task dispatch abstraction (enqueue indirection).

Design reference: "Phased Delivery 매핑" (stage 5 ``POST /api/collect-now`` →
"Celery enqueue 연결") and "API 엔드포인트 명세 - POST /api/collect-now".

This module is the single seam between the ``POST /api/collect-now`` route
(stage 5.3) and the Celery collect task (``prm.collect_workspace``) that is
created in stage 6.1. Defining the seam now lets the route be implemented and
fully functional (returns HTTP 202) before the Celery app exists, while
guaranteeing the wiring point for stage 6 is explicit rather than orphan code.

How the indirection works:

- :func:`enqueue_collect` performs a **lazy import** of the Celery task at call
  time (not at module import time). This is deliberate: importing the route /
  this module must never require the ``workers`` package to be importable, so
  the API process boots cleanly in stages 1–5 where no Celery app exists yet.
- When stage 6.1 adds ``app/workers/tasks/collect.py`` exporting
  ``collect_workspace`` (a Celery ``@task``), this function will find it,
  call ``.delay(workspace_id)`` and return the resulting Celery ``task.id`` —
  no change to the route required (Requirement 10.1, 10.3).
- Until then the import fails with ``ImportError`` (the task does not exist) or
  any Celery/broker error. We surface that as :class:`QueueUnavailableError`
  (HTTP 503, ``QUEUE_UNAVAILABLE``) so the API contract stays honest: if we
  cannot actually enqueue work, we say so rather than returning a fake task id.
"""

from __future__ import annotations

from app.core.errors import QueueUnavailableError
from app.core.logging import get_logger

logger = get_logger(__name__)


async def enqueue_collect(workspace_id: str) -> str:
    """Enqueue a Workspace collection job and return its task id.

    Lazily resolves the Celery collect task (``prm.collect_workspace``, added in
    stage 6.1) and dispatches it with ``.delay(workspace_id)``, returning the
    Celery-assigned ``task.id`` (Requirement 10.1, 10.3).

    Raises:
        QueueUnavailableError: if the Celery task/app is not importable yet
            (stages before 6.1) or the broker is unreachable, so the route can
            translate it to HTTP 503 ``QUEUE_UNAVAILABLE`` instead of pretending
            the job was queued.
    """
    try:
        # Lazy import: the workers package may not exist / be importable until
        # stage 6.1. Importing at call time keeps the API bootable without it.
        from app.workers.tasks.collect import collect_workspace
    except ImportError as exc:
        logger.warning(
            "collect_enqueue_unavailable",
            workspace_id=workspace_id,
            reason="collect_workspace task not available yet",
        )
        raise QueueUnavailableError(
            "수집 작업 큐를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        ) from exc

    try:
        async_result = collect_workspace.delay(workspace_id)
    except Exception as exc:  # noqa: BLE001 - broker/Celery failures -> 503
        logger.warning(
            "collect_enqueue_failed", workspace_id=workspace_id, exc_info=True
        )
        raise QueueUnavailableError(
            "수집 작업을 큐에 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        ) from exc

    task_id = async_result.id
    logger.info("collect_enqueued", workspace_id=workspace_id, task_id=task_id)
    return task_id
