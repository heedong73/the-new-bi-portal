"""Export 라우트 — /api/exports (독립 Export 조회 + 다운로드).

design.md "직접 Export 설계"(R9.6, R9.7, D-10) 참조.
GET /api/exports/{id}        : 상태 조회 (요청자 본인 or System_Operator)
GET /api/exports/{id}/file   : 파일 스트리밍 다운로드 (권한 동일)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.core.constants import RoleCode, ExportStatus
from app.core.deps import SessionDep, get_current_user
from app.core.errors import NotFoundError, PermissionDeniedError
from app.models.mail import ExportJob
from app.services.storage_service import get_storage_service

router = APIRouter(prefix="/api/exports", tags=["exports"])


async def _get_job_or_403(db: SessionDep, export_job_id: int, current: dict) -> ExportJob:
    """ExportJob 조회 + 소유자/System_Operator 권한 검증."""
    job = await db.scalar(select(ExportJob).where(ExportJob.id == export_job_id))
    if job is None:
        raise NotFoundError("Export 작업을 찾을 수 없습니다.")
    is_operator = RoleCode.SYSTEM_OPERATOR in current["roles"]
    if not is_operator and job.requested_by_user_id != current["user_id"]:
        raise PermissionDeniedError()
    return job


@router.get("/{export_job_id}")
async def get_export_status(
    export_job_id: int,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """Export 상태 + 파일 정보 반환. 완료 시 download_url 포함."""
    job = await _get_job_or_403(db, export_job_id, current)
    result: dict = {
        "export_job_id": job.id,
        "status": job.status,
        "export_format": job.export_format,
        "file_name": job.file_name,
        "mime_type": job.mime_type,
        "created_at": job.created_at.isoformat(),
    }
    if job.status == ExportStatus.SUCCEEDED and job.file_path:
        result["download_url"] = f"/api/exports/{job.id}/file"
    if job.error_message:
        result["error_message"] = job.error_message
    return result


@router.get("/{export_job_id}/file")
async def download_export_file(
    export_job_id: int,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """완료된 Export 파일을 스트리밍 다운로드."""
    job = await _get_job_or_403(db, export_job_id, current)
    if job.status != ExportStatus.SUCCEEDED or not job.file_path:
        raise NotFoundError("아직 다운로드 가능한 파일이 없습니다.")

    storage = get_storage_service()
    file_obj = storage.open(job.file_path)
    mime = job.mime_type or "application/octet-stream"
    fname = job.file_name or "export"
    return StreamingResponse(
        file_obj,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
