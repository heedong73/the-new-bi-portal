"""레포트 카탈로그 라우트 — /api/reports.

등록/수정/공개/이동은 System_Operator, 목록(GET)은 로그인 사용자(G+).
등록 시 workspace auto-upsert. 목록은 VIEW 권한 AND 공개 필터(Property 2).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.core.constants import AuditAction, RoleCode, PermissionAction
from app.core.deps import SessionDep, require_role, get_current_user
from app.core.errors import NotFoundError, ConflictError
from app.models.report import Report, Workspace
from app.schemas.report import (
    ReportCreate, ReportUpdate, VisibilityUpdate, FolderMoveRequest, ReportResponse,
)
from app.services.audit_service import append_audit
from app.services import permission_service

router = APIRouter(prefix="/api/reports", tags=["reports"])

_require_operator = require_role(RoleCode.SYSTEM_OPERATOR)

def _to_response(r: Report) -> ReportResponse:
    return ReportResponse(
        id=r.id, workspace_id=r.workspace_id, report_id=r.report_id,
        dataset_id=r.dataset_id, report_name=r.report_name, display_name=r.display_name,
        description=r.description, category=r.category, folder_id=r.folder_id,
        is_published=r.is_published,
    )

async def _upsert_workspace(db: SessionDep, workspace_id: str) -> None:
    """workspace_id가 workspaces에 없으면 생성 (auto-upsert)."""
    ws = await db.scalar(select(Workspace).where(Workspace.workspace_id == workspace_id))
    if ws is None:
        db.add(Workspace(workspace_id=workspace_id, workspace_name=workspace_id))
        await db.flush()

@router.get("", response_model=list[ReportResponse])
async def list_reports(
    db: SessionDep,
    current=Depends(get_current_user),
    folder_id: int | None = Query(default=None),
):
    """VIEW 권한 보유 + 공개 레포트 목록 (folder_id 필터 옵션)."""
    accessible = await permission_service.accessible_report_ids(
        db, current["user_id"], PermissionAction.VIEW
    )
    stmt = select(Report).where(Report.is_published == True)  # noqa: E712
    if folder_id is not None:
        stmt = stmt.where(Report.folder_id == folder_id)
    reports = (await db.execute(stmt.order_by(Report.id))).scalars().all()
    return [_to_response(r) for r in reports if r.id in accessible]

@router.post("", response_model=ReportResponse, status_code=201)
async def create_report(body: ReportCreate, db: SessionDep, op=Depends(_require_operator)):
    """ID 수동 등록 + workspace auto-upsert."""
    dup = await db.scalar(
        select(Report).where(
            Report.workspace_id == body.workspace_id, Report.report_id == body.report_id
        )
    )
    if dup is not None:
        raise ConflictError("이미 등록된 레포트입니다.")

    await _upsert_workspace(db, body.workspace_id)

    report = Report(
        workspace_id=body.workspace_id, report_id=body.report_id,
        dataset_id=body.dataset_id, report_name=body.report_name,
        display_name=body.display_name, description=body.description,
        folder_id=body.folder_id, is_published=False,
    )
    db.add(report)
    await db.flush()
    await append_audit(db, action=AuditAction.REPORT_CREATE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="report", resource_id=str(report.id),
                       meta={"report_id": report.id, "workspace_id": body.workspace_id})
    await db.commit()
    return _to_response(report)

@router.patch("/{report_id}", response_model=ReportResponse)
async def update_report(report_id: int, body: ReportUpdate, db: SessionDep, op=Depends(_require_operator)):
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")
    if body.display_name is not None:
        report.display_name = body.display_name
    if body.description is not None:
        report.description = body.description
    if body.category is not None:
        report.category = body.category
    await db.flush()
    await append_audit(db, action=AuditAction.REPORT_UPDATE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="report", resource_id=str(report_id),
                       meta={"report_id": report_id})
    await db.commit()
    return _to_response(report)

@router.patch("/{report_id}/visibility", response_model=ReportResponse)
async def change_visibility(report_id: int, body: VisibilityUpdate, db: SessionDep, op=Depends(_require_operator)):
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")
    report.is_published = body.is_published
    await db.flush()
    await append_audit(db, action=AuditAction.REPORT_VISIBILITY_CHANGE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="report", resource_id=str(report_id),
                       meta={"report_id": report_id, "after": "public" if body.is_published else "private"})
    await db.commit()
    return _to_response(report)

@router.patch("/{report_id}/folder", response_model=ReportResponse)
async def move_folder(report_id: int, body: FolderMoveRequest, db: SessionDep, op=Depends(_require_operator)):
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")
    report.folder_id = body.folder_id
    await db.flush()
    await append_audit(db, action=AuditAction.REPORT_UPDATE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="report", resource_id=str(report_id),
                       meta={"report_id": report_id, "folder_id": body.folder_id})
    await db.commit()
    return _to_response(report)


# ===== PBIX Import 업로드 (T-19) =====
import os
import tempfile
from fastapi import UploadFile, File, Form
from celery.result import AsyncResult
from app.core.errors import ValidationError as BIPValidationError
from app.workers.celery_app import celery_app
from app.workers.tasks.pbix_import import pbix_import

_MAX_PBIX_BYTES = 1024 * 1024 * 1024  # 1GB

@router.post("/{report_id}/pbix", status_code=202)
async def upload_pbix(
    report_id: int,
    db: SessionDep,
    op=Depends(_require_operator),
    file: UploadFile = File(...),
    workspace_id: str = Form(...),
    folder_id: int | None = Form(default=None),
):
    """PBIX 업로드 → 검증 → Worker 비동기 import. importId(task_id) 반환."""
    # 확장자 검증
    if not file.filename or not file.filename.lower().endswith(".pbix"):
        raise BIPValidationError("PBIX 파일(.pbix)만 업로드할 수 있습니다.")

    # 크기 검증하며 임시 저장
    fd, tmp_path = tempfile.mkstemp(suffix=".pbix")
    size = 0
    with os.fdopen(fd, "wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > _MAX_PBIX_BYTES:
                f.close()
                os.remove(tmp_path)
                raise BIPValidationError("허용 크기(1GB)를 초과했습니다.")
            f.write(chunk)

    task = pbix_import.delay(
        file_path=tmp_path, workspace_id=workspace_id,
        report_name=file.filename, folder_id=folder_id,
    )
    await append_audit(db, action=AuditAction.REPORT_CREATE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="report", resource_id=str(report_id),
                       meta={"target": "pbix_upload", "workspace_id": workspace_id})
    await db.commit()
    return {"importId": task.id, "status": "enqueued"}

@router.get("/imports/{import_id}")
async def import_status(import_id: str, _op=Depends(_require_operator)):
    """PBIX Import 진행/결과 조회 (Celery result backend)."""
    res = AsyncResult(import_id, app=celery_app)
    payload = {"importId": import_id, "state": res.state}
    if res.successful():
        payload["result"] = res.result
    elif res.failed():
        payload["error"] = str(res.result)
    return payload


# ===== Embed Token 발급 (T-20) =====
from app.core.deps import TokenServiceDep
from app.core.errors import PermissionDeniedError
from app.services import permission_service as _perm
from app.services.powerbi.embed_service import get_embed_info

@router.get("/{report_id}/embed")
async def get_embed(
    report_id: int,
    db: SessionDep,
    token_service: TokenServiceDep,
    current=Depends(get_current_user),
):
    """Report 한정 Embed Token 발급. VIEW 권한 없으면 403."""
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")

    allowed = await _perm.has_permission(
        db, current["user_id"], report_id, PermissionAction.VIEW
    )
    if not allowed:
        await append_audit(db, action=AuditAction.PERMISSION_DENIED, result="failure",
                           actor_user_id=current["user_id"], actor_label=current["emp_no"],
                           resource_type="report", resource_id=str(report_id))
        await db.commit()
        raise PermissionDeniedError()

    info = await get_embed_info(
        token_service, report.workspace_id, report.report_id, report.dataset_id
    )

    await append_audit(db, action=AuditAction.REPORT_VIEW, result="success",
                       actor_user_id=current["user_id"], actor_label=current["emp_no"],
                       resource_type="report", resource_id=str(report_id))
    await db.commit()

    return {
        "reportId": info.report_id,
        "embedUrl": info.embed_url,
        "embedToken": info.embed_token,
        "expiry": info.expiry,
    }

# ===== 새로고침 상태 (T-21) =====
from app.services.refresh_query import get_refresh_status
from app.schemas.refresh import RefreshStatusResponse

@router.get("/{report_id}/refresh-status", response_model=RefreshStatusResponse)
async def refresh_status(
    report_id: int,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """레포트 마지막 새로고침 + 다음 예약 (VIEW 권한 필요)."""
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")

    allowed = await _perm.has_permission(
        db, current["user_id"], report_id, PermissionAction.VIEW
    )
    if not allowed:
        raise PermissionDeniedError()

    return await get_refresh_status(db, report)


# ===== 독립 Export API (T-25) =====
from app.core.constants import ExportStatus
from app.models.mail import ExportJob
from app.schemas.report import ExportRequest
from app.workers.tasks.export_poll import export_poll

@router.post("/{report_id}/export", status_code=202)
async def start_export(
    report_id: int,
    body: ExportRequest,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """DOWNLOAD 권한 → ExportJob 생성 → export_poll 태스크 enqueue → 202."""
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")

    allowed = await _perm.has_permission(
        db, current["user_id"], report_id, PermissionAction.DOWNLOAD
    )
    if not allowed:
        await append_audit(
            db, action=AuditAction.PERMISSION_DENIED, result="failure",
            actor_user_id=current["user_id"], actor_label=current["emp_no"],
            resource_type="report", resource_id=str(report_id),
        )
        await db.commit()
        raise PermissionDeniedError()

    job = ExportJob(
        mail_job_id=None,
        requested_by_user_id=current["user_id"],
        report_id=report_id,
        workspace_id=report.workspace_id,
        export_format=body.export_format.upper(),
        status=ExportStatus.NOT_STARTED,
    )
    db.add(job)
    await db.flush()

    await append_audit(
        db, action=AuditAction.EXPORT_RUN, result="success",
        actor_user_id=current["user_id"], actor_label=current["emp_no"],
        resource_type="report", resource_id=str(report_id),
        meta={"export_format": body.export_format, "export_job_id": job.id},
    )
    await db.commit()

    export_poll.delay(job.id)
    return {"export_job_id": job.id, "status": "enqueued"}
