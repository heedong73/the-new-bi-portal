"""데이터셋 라우트 — /api/datasets (수동 새로고침)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.core.constants import AuditAction, PermissionAction
from app.core.deps import SessionDep, RedisDep, get_current_user
from app.core.errors import NotFoundError, PermissionDeniedError, ConflictError
from app.models.report import Report
from app.services import permission_service
from app.services.audit_service import append_audit
from app.services.powerbi.lock import is_locked
from app.workers.tasks.refresh_trigger import refresh_trigger

router = APIRouter(prefix="/api/datasets", tags=["datasets"])

_REFRESH_JOB_TYPE = "refresh"

@router.post("/{dataset_id}/refresh", status_code=202)
async def trigger_refresh(
    dataset_id: str,
    db: SessionDep,
    redis: RedisDep,
    current=Depends(get_current_user),
):
    """수동 새로고침 트리거. REFRESH 권한 검증, 진행 중이면 409."""
    # dataset_id로 연결된 report 찾기 (권한 판정 단위는 report)
    report = await db.scalar(select(Report).where(Report.dataset_id == dataset_id))
    if report is None:
        raise NotFoundError("해당 데이터셋과 연결된 레포트를 찾을 수 없습니다.")

    allowed = await permission_service.has_permission(
        db, current["user_id"], report.id, PermissionAction.REFRESH
    )
    if not allowed:
        await append_audit(db, action=AuditAction.PERMISSION_DENIED, result="failure",
                           actor_user_id=current["user_id"], actor_label=current["emp_no"],
                           resource_type="dataset", resource_id=dataset_id)
        await db.commit()
        raise PermissionDeniedError()

    # 진행 중이면 409
    if await is_locked(redis, _REFRESH_JOB_TYPE, dataset_id):
        raise ConflictError("이미 새로고침이 진행 중입니다.")

    task = refresh_trigger.delay(
        workspace_id=report.workspace_id, dataset_id=dataset_id, user_id=current["user_id"]
    )
    await append_audit(db, action=AuditAction.REFRESH_TRIGGER, result="success",
                       actor_user_id=current["user_id"], actor_label=current["emp_no"],
                       resource_type="dataset", resource_id=dataset_id,
                       meta={"dataset_id": dataset_id})
    await db.commit()
    return {"status": "enqueued", "taskId": task.id, "dataset_id": dataset_id}
