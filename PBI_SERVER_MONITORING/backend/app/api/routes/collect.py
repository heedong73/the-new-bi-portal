"""Immediate-collection trigger endpoint (``POST /api/collect-now``).

Design reference: "API 엔드포인트 명세 - POST /api/collect-now" and "Lock 정책".

Lets an operator trigger a Workspace collection immediately instead of waiting
for the next scheduled cycle (Requirement 10.1). The contract (design.md):

- 요청 본문: 없음, 또는 ``{"workspaceId": "..."}`` (선택). 생략 시
  ``settings.POWERBI_WORKSPACE_ID`` 를 사용한다.
- 이미 실행 중: HTTP 202 ``{"status": "already-running"}`` (Requirement 10.2).
- 정상 enqueue: HTTP 202 ``{"status": "enqueued", "taskId": "..."}`` (R10.3).

Lock policy (design "Lock 정책"): this route only *inspects* the distributed
collection lock via :func:`is_collect_locked` to decide ``already-running`` — it
does **not** acquire the lock. Acquiring/releasing the lock is the worker task's
job (stage 6.1), so the same lock key (``prm:lock:collect:{workspace_id}``)
guards both the scheduled run and this immediate trigger.

Enqueue is delegated to ``services/collect_dispatch.enqueue_collect`` which
lazily binds to the Celery task added in stage 6.1; until then it raises
``QueueUnavailableError`` (HTTP 503) handled by the global error handler.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from app.core.deps import RedisDep, SettingsDep
from app.schemas.common import ErrorResponse
from app.services.collect_dispatch import enqueue_collect
from app.services.powerbi.lock import is_collect_locked

router = APIRouter(tags=["collect"])


class CollectNowIn(BaseModel):
    """Optional request body for ``POST /api/collect-now``.

    ``workspaceId`` is optional; when omitted the route falls back to
    ``settings.POWERBI_WORKSPACE_ID`` (design.md 요청 본문 명세).
    """

    workspaceId: str | None = Field(
        default=None, description="수집 대상 Workspace ID (생략 시 기본 Workspace)"
    )


class CollectNowOut(BaseModel):
    """``POST /api/collect-now`` response (Requirement 10.2, 10.3).

    - ``enqueued`` → ``taskId`` 는 Celery task id.
    - ``already-running`` → ``taskId`` 는 ``None`` (락 검사 결과).
    """

    status: Literal["enqueued", "already-running"]
    taskId: str | None = None


@router.post(
    "/collect-now",
    response_model=CollectNowOut,
    status_code=status.HTTP_202_ACCEPTED,
    responses={503: {"model": ErrorResponse}},
)
async def collect_now(
    redis: RedisDep,
    settings: SettingsDep,
    body: CollectNowIn | None = None,
) -> CollectNowOut:
    """Trigger an immediate Workspace collection (HTTP 202).

    Resolves the target Workspace (request body ``workspaceId`` or the
    configured default), then:

    1. Checks the distributed collection lock. If a collection is already
       running for this Workspace, returns ``{"status": "already-running"}``
       without enqueueing (Requirement 10.2).
    2. Otherwise enqueues the collect task and returns
       ``{"status": "enqueued", "taskId": ...}`` (Requirement 10.1, 10.3).

    Both outcomes use HTTP 202 (Accepted) — the work is asynchronous. A queue
    failure surfaces as HTTP 503 ``QUEUE_UNAVAILABLE`` via the global handler.
    """
    workspace_id = (body.workspaceId if body else None) or settings.POWERBI_WORKSPACE_ID

    # Point-in-time lock check only — the worker owns acquire/release (design
    # "Lock 정책"). Same key guards the scheduled run and this trigger.
    if await is_collect_locked(redis, workspace_id):
        return CollectNowOut(status="already-running")

    task_id = await enqueue_collect(workspace_id)
    return CollectNowOut(status="enqueued", taskId=task_id)
