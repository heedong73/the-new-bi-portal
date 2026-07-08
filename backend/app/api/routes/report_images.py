"""저장 이미지 다운로드 — /api/report-images/{id} (T-43, R16.9/R31/R38).

메일 파이프라인이 저장한 Report_Image_Path 이미지를 권한 검증 후 스트리밍한다.
파일 본체는 StorageService(저장소)에만 있고 DB엔 경로만 있으므로, 권한 확인 →
저장소 스트리밍 방식으로 제공한다(정적 URL 미노출, 권한 우회 방지).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.core.constants import PermissionAction, RoleCode
from app.core.deps import SessionDep, get_current_user
from app.core.errors import NotFoundError, PermissionDeniedError
from app.core.http_utils import content_disposition
from app.models.mail import MailJob, MailSchedule, ReportImagePath
from app.services import permission_service
from app.services.storage_service import get_storage_service

router = APIRouter(prefix="/api/report-images", tags=["report-images"])


async def _resolve_report_id(db: SessionDep, image: ReportImagePath) -> int | None:
    """이미지 → mail_job → mail_schedule → report_id 해석."""
    if image.mail_job_id is None:
        return None
    schedule_id = await db.scalar(
        select(MailJob.mail_schedule_id).where(MailJob.id == image.mail_job_id)
    )
    if schedule_id is None:
        return None
    return await db.scalar(
        select(MailSchedule.report_id).where(MailSchedule.id == schedule_id)
    )


@router.get("/{image_id}")
async def download_report_image(
    image_id: int,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """저장 이미지 스트리밍 다운로드. 연결된 레포트 VIEW 권한 또는 System_Operator."""
    image = await db.scalar(select(ReportImagePath).where(ReportImagePath.id == image_id))
    if image is None:
        raise NotFoundError("이미지를 찾을 수 없습니다.")

    is_operator = RoleCode.SYSTEM_OPERATOR in current["roles"]
    if not is_operator:
        report_id = await _resolve_report_id(db, image)
        allowed = report_id is not None and await permission_service.has_permission(
            db, current["user_id"], report_id, PermissionAction.VIEW
        )
        if not allowed:
            raise PermissionDeniedError()

    storage = get_storage_service()
    try:
        file_obj = storage.open(image.image_path)
    except FileNotFoundError:
        raise NotFoundError("이미지 파일이 저장소에 없습니다.")

    mime = image.mime_type or "application/octet-stream"
    fname = image.file_name or f"image-{image.id}.png"
    return StreamingResponse(
        file_obj,
        media_type=mime,
        headers={"Content-Disposition": content_disposition(fname, inline=True)},
    )
