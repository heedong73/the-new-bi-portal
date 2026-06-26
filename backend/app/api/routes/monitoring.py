"""모니터링 라우트 — /api/collect-now, /api/health, /api/monitoring/status."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.core.constants import RoleCode
from app.core.config import settings
from app.core.deps import SessionDep, RedisDep, require_menu
from app.services import monitoring_service
from app.services.powerbi.lock import is_collect_locked
from app.workers.tasks.collect import collect_workspace_task

router = APIRouter(tags=["monitoring"])

_require_operator = require_menu("monitoring_ops")

@router.post("/api/collect-now")
async def collect_now(redis: RedisDep, _op=Depends(_require_operator)):
    """즉시 수집 트리거 (진행 중이면 already-running)."""
    workspace_id = settings.POWERBI_WORKSPACE_ID
    if await is_collect_locked(redis, workspace_id):
        return {"status": "already-running", "workspace_id": workspace_id}
    task = collect_workspace_task.delay(workspace_id)
    return {"status": "enqueued", "taskId": task.id, "workspace_id": workspace_id}

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
