"""모니터링 라우트 — /api/collect-now, /api/health, /api/monitoring/status."""
from __future__ import annotations

import time
from datetime import datetime, timezone

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
    """핵심 의존성·예약 경로·Power BI 연결과 최근 작업 상태를 집계한다."""
    checked_at = datetime.now(timezone.utc).isoformat()

    # 성공 여부뿐 아니라 지연 시간도 남겨 장애 전 느려짐을 확인할 수 있게 한다.
    db_started = time.perf_counter()
    try:
        await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    db_latency_ms = round((time.perf_counter() - db_started) * 1000, 1)

    redis_started = time.perf_counter()
    try:
        await redis.ping()
        redis_ok = True
    except Exception:
        redis_ok = False
    redis_latency_ms = round((time.perf_counter() - redis_started) * 1000, 1)

    worker = await monitoring_service.worker_status()
    worker_ok = bool(worker["ok"])

    if redis_ok:
        # 공용 Redis 클라이언트를 순차로 사용해 커넥션 풀에 여분 연결을 남기지 않는다.
        # 세 호출 모두 짧고, Power BI 확인은 60초 캐시라 순차 실행이 응답 시간에 불리하지 않다.
        scheduler = await monitoring_service.scheduler_status(redis)
        queued_tasks = await monitoring_service.queue_depth(redis)
        powerbi = await monitoring_service.powerbi_status(redis)
    else:
        scheduler = {
            "status": "unknown", "last_heartbeat": None, "age_seconds": None,
            "message": "Redis 장애 영향으로 스케줄러 상태를 확인할 수 없습니다.",
        }
        queued_tasks = None
        powerbi = {
            "status": "unknown", "checked_at": None, "latency_ms": None,
            "http_status": None,
            "message": "Redis 장애 영향으로 Power BI 인증 상태를 확인할 수 없습니다.",
        }

    # DB 장애와 실제 작업 0건을 혼동하지 않도록 조회 가능 여부를 별도 반환한다.
    jobs: dict = {"refresh": [], "mail": [], "export": []}
    failures: dict = {"refresh": 0, "mail": 0, "export": 0}
    jobs_available = False
    jobs_error: str | None = None
    if db_ok:
        try:
            jobs = await monitoring_service.recent_jobs(db)
            failures = await monitoring_service.recent_failures(db)
            jobs_available = True
        except Exception:
            jobs_error = "최근 작업 이력을 조회하지 못했습니다."
    else:
        jobs_error = "데이터베이스 장애로 최근 작업 이력을 조회할 수 없습니다."

    has_failures = any(v > 0 for v in failures.values())
    component_error = (
        not db_ok
        or not redis_ok
        or not worker_ok
        or scheduler["status"] == "unavailable"
        or powerbi["status"] == "error"
    )
    component_warning = (
        not jobs_available
        or scheduler["status"] == "unknown"
        or powerbi["status"] in ("degraded", "unknown")
    )
    overall_status = "error" if component_error else "degraded" if component_warning or has_failures else "ok"

    return {
        # 기존 필드는 하위호환을 위해 유지한다.
        "db": "ok" if db_ok else "error",
        "redis": "ok" if redis_ok else "error",
        "worker": "ok" if worker_ok else "unavailable",
        "worker_count": worker["count"],
        "app_mode": settings.APP_MODE,
        "auth_mode": settings.AUTH_MODE,
        "recent_jobs": jobs,
        "recent_failures": failures,
        "has_recent_failures": has_failures,
        # 운영 진단 확장 필드.
        "overall_status": overall_status,
        "checked_at": checked_at,
        "db_latency_ms": db_latency_ms,
        "redis_latency_ms": redis_latency_ms,
        "worker_ids": worker["worker_ids"],
        "active_tasks": worker["active_tasks"],
        "queued_tasks": queued_tasks,
        "scheduler": scheduler,
        "powerbi": powerbi,
        "recent_jobs_available": jobs_available,
        "recent_jobs_error": jobs_error,
    }
