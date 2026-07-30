"""Export 라우트 — /api/exports (독립 Export 조회 + 다운로드).

design.md "직접 Export 설계"(R9.6, R9.7, D-10) 참조.
GET /api/exports/{id}        : 상태 조회 (요청자 본인 or System_Operator)
GET /api/exports/{id}/file   : 파일 스트리밍 다운로드 (권한 동일)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.core.constants import AuditAction, RoleCode, ExportStatus
from app.core.deps import SessionDep, get_current_user
from app.core.errors import NotFoundError, PermissionDeniedError
from app.core.http_utils import content_disposition
from app.models.mail import ExportJob
from app.models.report import Report
from app.services.audit_service import append_audit, build_audit_snapshot
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

    # 파일 open이 성공한 뒤에만 "다운로드 요청/스트리밍 시작" 이벤트를 남긴다.
    # HTTP 스트리밍 특성상 클라이언트가 마지막 바이트까지 수신했는지는 서버가 보장할 수 없다.
    report = None
    if job.report_id is not None:
        report = await db.scalar(select(Report).where(Report.id == job.report_id))
    actor_user_id = None if current.get("is_local_admin") else current.get("user_id")
    snapshot = await build_audit_snapshot(
        db, actor_user_id=actor_user_id, report=report,
    )
    try:
        await append_audit(
            db,
            action=AuditAction.EXPORT_DOWNLOAD,
            result="success",
            actor_user_id=actor_user_id,
            actor_label=current.get("emp_no"),
            resource_type="report" if report is not None else "export",
            resource_id=str(report.id if report is not None else job.id),
            meta={
                "export_job_id": job.id,
                "export_format": job.export_format,
                "report_id": job.report_id,
            },
            **snapshot,
        )
        await db.commit()
    except Exception:
        file_obj.close()
        raise

    return StreamingResponse(
        file_obj,
        media_type=mime,
        headers={"Content-Disposition": content_disposition(fname)},
    )
