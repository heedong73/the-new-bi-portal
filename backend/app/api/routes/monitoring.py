"""모니터링 라우트 — /api/collect-now, /api/health, /api/monitoring/status."""
from __future__ import annotations

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from app.core.constants import AuditAction, RoleCode
from app.core.config import settings
from app.core.deps import SessionDep, RedisDep, require_menu
from app.schemas.refresh import CollectNowOut, CollectStatusOut
from app.services import monitoring_service
from app.services.audit_service import append_audit
from app.services.powerbi.lock import is_collect_locked
from app.workers.celery_app import celery_app
from app.workers.tasks.collect import collect_workspace_task

router = APIRouter(tags=["monitoring"])

_require_operator = require_menu("monitoring_ops")

@router.post("/api/collect-now", response_model=CollectNowOut, status_code=202)
async def collect_now(
    db: SessionDep,
    redis: RedisDep,
    current=Depends(require_menu("monitoring_refresh")),
):
    """즉시 수집 트리거 (HTTP 202).

    다음 예약 주기를 기다리지 않고 운영자가 바로 수집을 실행한다. 분산 락
    (bip:lock:collect:{workspace_id})을 점검만 하여 이미 진행 중이면 enqueue 없이
    ``already-running`` 을 반환하고(락 획득/해제는 워커 태스크가 담당), 아니면
    collect_workspace_task 를 enqueue 하고 ``enqueued`` + taskId 를 반환한다.

    호출부는 Refresh 현황 화면(monitoring_refresh)뿐이므로 게이트를 해당 메뉴에 맞춘다.
    """
    workspace_id = settings.POWERBI_WORKSPACE_ID
    if await is_collect_locked(redis, workspace_id):
        return CollectNowOut(status="already-running")

    task = collect_workspace_task.delay(workspace_id)
    await append_audit(
        db,
        action=AuditAction.COLLECT_NOW,
        result="success",
        actor_user_id=current["user_id"],
        actor_label=current.get("emp_no"),
        resource_type="workspace",
        resource_id=workspace_id,
        meta={"task_id": task.id},
    )
    await db.commit()
    return CollectNowOut(status="enqueued", taskId=task.id)


@router.get("/api/collect-status", response_model=CollectStatusOut)
async def collect_status(
    redis: RedisDep,
    task_id: str | None = Query(default=None),
    current=Depends(require_menu("monitoring_refresh")),
):
    """수집 진행/결과를 반환한다.

    task_id가 주어지면 그 수집 태스크의 **실제 결과**(성공/실패/스킵)를 Celery
    결과 백엔드에서 읽어 반영한다 — 락만 보면 실패해도 '완료'로 오표시되므로.
    task_id가 없으면(하위호환/복원) 분산 락 점유 여부로 running만 판정한다.
    Refresh 현황 진행 배너(BackgroundTaskDock)가 이 값을 폴링한다.
    """
    if task_id:
        ar = AsyncResult(task_id, app=celery_app)
        state = ar.state
        if state in ("PENDING", "RECEIVED", "STARTED", "RETRY"):
            return CollectStatusOut(running=True, state="running")
        if state == "SUCCESS":
            result = ar.result if isinstance(ar.result, dict) else {}
            rstatus = result.get("status")
            if rstatus == "failed":
                return CollectStatusOut(running=False, state="failed", error=result.get("error"))
            if rstatus == "already-running":
                return CollectStatusOut(running=False, state="skipped")
            return CollectStatusOut(running=False, state="succeeded")
        if state == "FAILURE":
            return CollectStatusOut(running=False, state="failed", error=str(ar.result))
        return CollectStatusOut(running=False, state="unknown")

    workspace_id = settings.POWERBI_WORKSPACE_ID
    running = await is_collect_locked(redis, workspace_id)
    return CollectStatusOut(running=running, state="running" if running else "unknown")

@router.get("/api/health")
async def health():
    return {"status": "ok"}

@router.get("/api/monitoring/status")
async def monitoring_status(db: SessionDep, redis: RedisDep, _op=Depends(_require_operator)):
    """DB/Redis/Worker 상태 + 최근 작업 결과 + 최근 실패 (R36.2, R36.3)."""
    # DB 연결
    try:
        await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    # Redis 연결
    try:
        await redis.ping()
        redis_ok = True
    except Exception:
        redis_ok = False

    # Worker 가용성
    worker_ok, worker_count = await monitoring_service.ping_workers()

    # 최근 작업 + 최근 실패 (DB 가용 시에만 조회)
    jobs: dict = {"refresh": [], "mail": [], "export": []}
    failures: dict = {"refresh": 0, "mail": 0, "export": 0}
    if db_ok:
        try:
            jobs = await monitoring_service.recent_jobs(db)
            failures = await monitoring_service.recent_failures(db)
        except Exception:
            pass

    has_failures = any(v > 0 for v in failures.values())

    return {
        "db": "ok" if db_ok else "error",
        "redis": "ok" if redis_ok else "error",
        "worker": "ok" if worker_ok else "unavailable",
        "worker_count": worker_count,
        "app_mode": settings.APP_MODE,
        "auth_mode": settings.AUTH_MODE,
        "recent_jobs": jobs,
        "recent_failures": failures,
        "has_recent_failures": has_failures,
    }
