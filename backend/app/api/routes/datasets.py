"""데이터셋 라우트 — /api/datasets (수동 새로고침/취소)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.core.config import settings
from app.core.constants import AuditAction, PermissionAction
from app.core.deps import (
    PowerBIClientDep,
    RedisDep,
    SessionDep,
    get_current_user,
)
from app.core.errors import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    PowerBIUpstreamError,
)
from app.models.report import Report
from app.services import permission_service
from app.services.audit_service import append_audit
from app.services.powerbi.lock import acquire_lock, release_lock
from app.workers.tasks.refresh_trigger import (
    REFRESH_HISTORY_GRACE_SEC,
    REFRESH_ID_TTL_SEC,
    refresh_id_key,
    refresh_trigger,
)

router = APIRouter(prefix="/api/datasets", tags=["datasets"])

_REFRESH_JOB_TYPE = "refresh"
_REFRESH_TERMINAL_STATUSES = frozenset({"Completed", "Failed", "Disabled", "Cancelled"})
_ENHANCED_REFRESH_TYPE = "ViaEnhancedApi"
# API enqueue부터 워커 POST 완료까지 동일 소유권 토큰으로 유지하는 예약 락.
_REFRESH_SUBMIT_LOCK_TTL_SEC = 10 * 60


async def _read_refresh_tracking(redis, dataset_id: str) -> tuple[str | None, bool]:
    """저장된 requestId와 Power BI 이력 전파 유예 시간 내 여부를 반환한다."""
    try:
        key = refresh_id_key(dataset_id)
        refresh_id = await redis.get(key)
        ttl = await redis.ttl(key) if refresh_id else -2
    except Exception:
        return None, False
    is_recent = ttl > REFRESH_ID_TTL_SEC - REFRESH_HISTORY_GRACE_SEC
    return (str(refresh_id) if refresh_id else None), is_recent


async def _require_refresh_permission(
    dataset_id: str,
    db: SessionDep,
    current: dict,
) -> Report:
    """dataset에 연결된 report를 찾고 현재 사용자의 REFRESH 권한을 검증한다."""
    report = await db.scalar(select(Report).where(Report.dataset_id == dataset_id))
    if report is None:
        raise NotFoundError("해당 데이터셋과 연결된 레포트를 찾을 수 없습니다.")

    allowed = await permission_service.has_permission(
        db,
        current["user_id"],
        report.id,
        PermissionAction.REFRESH,
        roles=current.get("roles"),
    )
    if not allowed:
        await append_audit(
            db,
            action=AuditAction.PERMISSION_DENIED,
            result="failure",
            actor_user_id=current["user_id"],
            actor_label=current["emp_no"],
            resource_type="dataset",
            resource_id=dataset_id,
        )
        await db.commit()
        raise PermissionDeniedError()
    return report


@router.post("/{dataset_id}/refresh", status_code=202)
async def trigger_refresh(
    dataset_id: str,
    db: SessionDep,
    redis: RedisDep,
    client: PowerBIClientDep,
    current=Depends(get_current_user),
):
    """수동 enhanced refresh 트리거. REFRESH 권한 검증, 진행 중이면 409."""
    report = await _require_refresh_permission(dataset_id, db, current)

    # 점검과 enqueue 사이에도 두 요청이 동시에 통과하지 않도록 원자적으로 예약한다.
    # 이 토큰은 워커에 전달되며 Power BI POST가 끝날 때 소유권 기반으로 해제된다.
    lock_value = await acquire_lock(
        redis,
        _REFRESH_JOB_TYPE,
        dataset_id,
        ttl_sec=_REFRESH_SUBMIT_LOCK_TTL_SEC,
    )
    if lock_value is None:
        raise ConflictError("이미 새로고침이 진행 중입니다.")

    try:
        stored_refresh_id, tracking_is_recent = await _read_refresh_tracking(
            redis, dataset_id
        )
        runs = await client.list_refreshes(report.workspace_id, dataset_id, top=10)
        active_runs = [
            run for run in runs if run.status not in _REFRESH_TERMINAL_STATUSES
        ]
        stored_run = next(
            (run for run in runs if stored_refresh_id and run.request_id == stored_refresh_id),
            None,
        )

        # Live Power BI는 모델당 한 번에 하나의 refresh만 허용하므로 어떤 종류든 진행
        # 중인 작업이 있으면 막는다. Mock의 생성형 fixture에는 실제 진행과 무관한 임의
        # Unknown 행이 섞여 있으므로, mock에서는 우리가 실제로 추적하는 enhanced refresh
        # (ViaEnhancedApi)만 중복 판정 대상으로 좁힌다.
        blocking_runs = (
            [r for r in active_runs if r.refresh_type == _ENHANCED_REFRESH_TYPE]
            if settings.APP_MODE == "mock"
            else active_runs
        )
        if blocking_runs:
            raise ConflictError("이미 새로고침이 진행 중입니다.")
        if stored_refresh_id and tracking_is_recent and stored_run is None:
            # Redis에는 최근 requestId가 있지만 Power BI 이력에 아직 반영되지 않은
            # propagation 레이스. 안전하게 중복으로 간주해 막는다(그레이스 구간 내에서만).
            raise ConflictError("이미 새로고침 요청을 처리하고 있습니다.")

        # 진행 작업이 없음을 확인한 뒤에만 과거 추적 ID/캐시를 지운다. 기존 실행 중
        # requestId를 먼저 지워 새 작업이 그 실행에 붙는 레이스를 만들지 않는다.
        try:
            await redis.delete(
                refresh_id_key(dataset_id),
                f"bip:livestatus:{report.workspace_id}:{dataset_id}",
            )
        except Exception:
            pass

        task = refresh_trigger.delay(
            workspace_id=report.workspace_id,
            dataset_id=dataset_id,
            user_id=current["user_id"],
            lock_value=lock_value,
        )
    except Exception:
        # 워커에 소유권을 넘기기 전 실패한 경우에만 API가 예약 락을 해제한다.
        await release_lock(redis, _REFRESH_JOB_TYPE, dataset_id, lock_value)
        raise

    await append_audit(
        db,
        action=AuditAction.REFRESH_TRIGGER,
        result="success",
        actor_user_id=current["user_id"],
        actor_label=current["emp_no"],
        resource_type="dataset",
        resource_id=dataset_id,
        meta={"dataset_id": dataset_id, "mode": "enhanced"},
    )
    await db.commit()
    return {"status": "enqueued", "taskId": task.id, "dataset_id": dataset_id}


@router.delete("/{dataset_id}/refresh")
async def cancel_refresh(
    dataset_id: str,
    db: SessionDep,
    redis: RedisDep,
    client: PowerBIClientDep,
    current=Depends(get_current_user),
):
    """진행 중인 enhanced refresh를 Power BI Cancel Refresh API로 중지한다.

    워커가 저장한 requestId를 우선 사용하되, Redis 기록이 없거나 만료된 경우에는
    Power BI 새로고침 이력에서 진행 중인 ViaEnhancedApi 항목을 찾아 복구한다.
    표준/예약 새로고침은 Power BI DELETE API로 중지할 수 없으므로 409를 반환한다.
    """
    report = await _require_refresh_permission(dataset_id, db, current)

    stored_refresh_id, tracking_is_recent = await _read_refresh_tracking(redis, dataset_id)

    runs = await client.list_refreshes(report.workspace_id, dataset_id, top=10)
    active_runs = [run for run in runs if run.status not in _REFRESH_TERMINAL_STATUSES]

    # 전체 이력(활성+종료)에서 stored ID를 먼저 찾는다. 이미 종료 상태로 나타나면 그
    # 요청은 실제로 끝난 것이므로(취소 대상 아님) 아래에서 활성 목록에 포함되지 않아
    # "재시도 불필요" 경로로 자연스럽게 떨어진다.
    stored_run = next(
        (run for run in runs if stored_refresh_id and run.request_id == stored_refresh_id),
        None,
    )

    # Redis requestId와 일치하는 "활성" 항목이 가장 신뢰도가 높다. stored_run이 이력에
    # 있지만 이미 종료 상태라면(=완료/취소됨) matching_run에서 제외해 재취소를 막는다.
    matching_run = stored_run if stored_run in active_runs else None
    enhanced_run = next(
        (run for run in active_runs if run.refresh_type == _ENHANCED_REFRESH_TYPE),
        None,
    )
    selected_run = matching_run or enhanced_run

    if selected_run is not None:
        if selected_run.refresh_type != _ENHANCED_REFRESH_TYPE:
            raise ConflictError(
                "현재 진행 중인 새로고침은 중지할 수 없는 방식으로 시작되었습니다."
            )
        refresh_id = selected_run.request_id
    elif stored_refresh_id and stored_run is None and tracking_is_recent:
        # 워커가 requestId를 저장했지만 Power BI 이력 목록에 아직 반영되지 않은 레이스.
        # 트리거 직후의 짧은 그레이스 구간에서만 신뢰한다 — 오래된(하지만 아직 TTL이
        # 남은) ID를 이력에 없다고 무조건 재시도하면, 이미 끝난 요청에 불필요한 DELETE를
        # 반복 시도하게 된다.
        refresh_id = str(stored_refresh_id)
    elif active_runs:
        raise ConflictError(
            "현재 진행 중인 새로고침은 중지할 수 없는 방식으로 시작되었습니다."
        )
    else:
        raise ConflictError("중지할 진행 중인 새로고침이 없습니다.")

    if not refresh_id:
        raise ConflictError("새로고침 작업 식별자를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.")

    try:
        await client.cancel_refresh(report.workspace_id, dataset_id, refresh_id)
    except PowerBIUpstreamError as exc:
        if exc.details.get("http_status") in (400, 404):
            try:
                await redis.delete(refresh_id_key(dataset_id))
            except Exception:
                pass
            raise ConflictError(
                "새로고침이 이미 종료되었거나 중지할 수 없는 상태입니다."
            ) from exc
        raise

    # 취소 요청 수락 후 추적 ID와 실시간 상태 캐시를 지워 다음 폴링이 Power BI에서
    # Cancelled 상태를 즉시 다시 읽도록 한다.
    try:
        await redis.delete(
            refresh_id_key(dataset_id),
            f"bip:livestatus:{report.workspace_id}:{dataset_id}",
        )
    except Exception:
        pass

    await append_audit(
        db,
        action=AuditAction.REFRESH_CANCEL,
        result="success",
        actor_user_id=current["user_id"],
        actor_label=current["emp_no"],
        resource_type="dataset",
        resource_id=dataset_id,
        meta={"dataset_id": dataset_id, "refresh_id": refresh_id},
    )
    await db.commit()
    return {
        "status": "cancellation_requested",
        "dataset_id": dataset_id,
        "refresh_id": refresh_id,
    }
