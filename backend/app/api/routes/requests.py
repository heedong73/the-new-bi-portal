"""서비스 센터 API (T-46/T-47/T-52, R17).

화면 표기는 "서비스 센터", 내부 엔드포인트/모델은 requests 유지.

POST   /api/requests                       — 요청 생성 (인증된 모든 사용자)
GET    /api/requests                       — 목록 (일반=본인만, System_Operator=전체)
GET    /api/requests/{id}                  — 단건 (소유자 또는 System_Operator)
PATCH  /api/requests/{id}                  — 상태/우선순위/응답/반려 (System_Operator)
POST   /api/requests/{id}/attachments      — 첨부 업로드 (소유자 또는 운영자)
GET    /api/requests/{id}/attachments      — 첨부 목록
GET    /api/request-attachments/{id}       — 첨부 다운로드(권한 검증 스트리밍)
DELETE /api/request-attachments/{id}       — 첨부 삭제 (소유자 또는 운영자)
POST   /api/requests/{id}/comments         — 댓글 작성 (소유자 또는 운영자)
"""
from __future__ import annotations

import uuid
from pathlib import PurePosixPath
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, File, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.core.config import settings
from app.core.constants import AuditAction, RoleCode
from app.core.timezone import to_local
from app.core.deps import SessionDep, get_current_user, require_role
from app.core.errors import NotFoundError, ValidationError
from app.models.auth import User, Department
from app.models.log import (
    Request as RequestModel,
    RequestAttachment,
    RequestComment,
)
from app.schemas.request_center import (
    AttachmentResponse,
    CommentCreate,
    CommentResponse,
    RequestCreate,
    RequestResponse,
    RequestUpdate,
)
from app.services import request_notify
from app.services.audit_service import append_audit
from app.services.storage_service import get_storage_service

router = APIRouter(tags=["requests"])

# 허용 확장자 (소문자, 점 포함). 이미지 + 일반 문서/텍스트/압축.
_IMAGE_EXTS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"})
_ALLOWED_EXTS = _IMAGE_EXTS | frozenset({
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".txt", ".csv", ".log", ".zip",
})


def _max_attachment_bytes() -> int:
    return settings.REQUEST_ATTACHMENT_MAX_MB * 1024 * 1024


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------

def _is_operator(current: dict) -> bool:
    return (
        RoleCode.SYSTEM_OPERATOR.value in current.get("roles", [])
        or bool(current.get("is_local_admin"))
    )


def _is_image(mime: str | None, file_name: str) -> bool:
    if mime and mime.lower().startswith("image/"):
        return True
    return PurePosixPath(file_name.lower()).suffix in _IMAGE_EXTS


async def _user_info_map(db: SessionDep, user_ids: set[int]) -> dict[int, tuple[str | None, str | None]]:
    """user_id → (이름, 부서명) 매핑. 응답의 requester_name/requester_department 채우기."""
    if not user_ids:
        return {}
    rows = (
        await db.execute(
            select(User.id, User.name, Department.name)
            .join(Department, Department.id == User.department_id, isouter=True)
            .where(User.id.in_(user_ids))
        )
    ).all()
    return {uid: (name, dept) for uid, name, dept in rows}


async def _attachments_map(
    db: SessionDep, request_ids: set[int]
) -> dict[int, list[RequestAttachment]]:
    if not request_ids:
        return {}
    rows = (
        await db.execute(
            select(RequestAttachment)
            .where(RequestAttachment.request_id.in_(request_ids))
            .order_by(RequestAttachment.id)
        )
    ).scalars().all()
    grouped: dict[int, list[RequestAttachment]] = {}
    for a in rows:
        grouped.setdefault(a.request_id, []).append(a)
    return grouped


async def _comments_map(
    db: SessionDep, request_ids: set[int]
) -> dict[int, list[RequestComment]]:
    if not request_ids:
        return {}
    rows = (
        await db.execute(
            select(RequestComment)
            .where(RequestComment.request_id.in_(request_ids))
            .order_by(RequestComment.id)
        )
    ).scalars().all()
    grouped: dict[int, list[RequestComment]] = {}
    for c in rows:
        grouped.setdefault(c.request_id, []).append(c)
    return grouped


def _attachment_to_response(a: RequestAttachment) -> AttachmentResponse:
    return AttachmentResponse(
        id=a.id,
        request_id=a.request_id,
        file_name=a.file_name,
        mime_type=a.mime_type,
        file_size=a.file_size,
        is_image=_is_image(a.mime_type, a.file_name),
        created_at=to_local(a.created_at),
    )


def _comment_to_response(c: RequestComment) -> CommentResponse:
    return CommentResponse(
        id=c.id,
        request_id=c.request_id,
        author_user_id=c.author_user_id,
        author_label=c.author_label,
        is_operator=c.is_operator,
        body=c.body,
        created_at=to_local(c.created_at),
    )


def _to_response(
    row: RequestModel,
    name: str | None,
    department: str | None = None,
    attachments: list[RequestAttachment] | None = None,
    comments: list[RequestComment] | None = None,
) -> RequestResponse:
    return RequestResponse(
        id=row.id,
        requester_id=row.requester_id,
        requester_name=name,
        requester_department=department,
        request_type=row.request_type,
        title=row.title,
        body=row.body,
        status=row.status,
        operator_response=row.operator_response,
        reject_reason=row.reject_reason,
        expected_completion_date=row.expected_completion_date,
        created_at=to_local(row.created_at),
        updated_at=to_local(row.updated_at),
        attachments=[_attachment_to_response(a) for a in (attachments or [])],
        comments=[_comment_to_response(c) for c in (comments or [])],
    )


async def _build_single(db: SessionDep, row: RequestModel, name: str | None, department: str | None) -> RequestResponse:
    attach = await _attachments_map(db, {row.id})
    comments = await _comments_map(db, {row.id})
    return _to_response(row, name, department, attach.get(row.id, []), comments.get(row.id, []))


async def _get_request_or_404(db: SessionDep, request_id: int) -> RequestModel:
    row = await db.scalar(select(RequestModel).where(RequestModel.id == request_id))
    if row is None:
        raise NotFoundError("요청을 찾을 수 없습니다.")
    return row


def _ensure_can_access(current: dict, row: RequestModel) -> None:
    """소유자 또는 운영자만 접근. 무권한은 404(존재 비노출)."""
    if not _is_operator(current) and row.requester_id != current["user_id"]:
        raise NotFoundError("요청을 찾을 수 없습니다.")


# ---------------------------------------------------------------------------
# POST /api/requests — 생성
# ---------------------------------------------------------------------------

@router.post("/api/requests", response_model=RequestResponse, status_code=201)
async def create_request(
    body: RequestCreate,
    background: BackgroundTasks,
    *,
    db: SessionDep,
    current: dict = Depends(get_current_user),
):
    """요청 생성. requester_id는 세션 사용자로 강제(클라이언트 입력 무시)."""
    row = RequestModel(
        requester_id=current["user_id"],
        request_type=body.request_type,
        title=body.title,
        body=body.body,
        status="pending",
    )
    db.add(row)
    await db.flush()

    await append_audit(
        db,
        action=AuditAction.REQUEST_CREATE,
        result="success",
        actor_user_id=current["user_id"],
        resource_type="request",
        resource_id=str(row.id),
        meta={"request_id": row.id, "request_type": row.request_type},
    )

    await db.commit()
    await db.refresh(row)

    # 새 요청 → 관리자 이메일로 알림(설정값). best-effort 백그라운드 발송.
    admin_email = settings.REQUEST_ADMIN_EMAIL
    if admin_email:
        subject, html_body = request_notify.build_new_request(
            title=row.title,
            requester_name=current.get("name") or "",
            request_type=row.request_type,
        )
        background.add_task(request_notify.send_notification, subject, [admin_email], html_body)

    return _to_response(row, current.get("name"), None, [], [])


# ---------------------------------------------------------------------------
# GET /api/requests — 목록
# ---------------------------------------------------------------------------

@router.get("/api/requests", response_model=list[RequestResponse])
async def list_requests(
    status: str | None = Query(default=None, description="상태 필터"),
    request_type: str | None = Query(default=None, alias="type", description="유형 필터"),
    q: str | None = Query(default=None, description="제목/요청자 검색"),
    *,
    db: SessionDep,
    current: dict = Depends(get_current_user),
):
    """요청 목록. 일반 사용자는 본인 요청만, System_Operator는 전체."""
    stmt = select(RequestModel).order_by(RequestModel.id.desc())

    if not _is_operator(current):
        stmt = stmt.where(RequestModel.requester_id == current["user_id"])

    if status:
        stmt = stmt.where(RequestModel.status == status)
    if request_type:
        stmt = stmt.where(RequestModel.request_type == request_type)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.join(User, User.id == RequestModel.requester_id).where(
            RequestModel.title.ilike(like) | User.name.ilike(like)
        )

    rows = (await db.execute(stmt)).scalars().all()
    ids = {r.id for r in rows}
    info = await _user_info_map(db, {r.requester_id for r in rows})
    attach = await _attachments_map(db, ids)
    comments = await _comments_map(db, ids)
    return [
        _to_response(r, *(info.get(r.requester_id, (None, None))), attach.get(r.id, []), comments.get(r.id, []))
        for r in rows
    ]


# ---------------------------------------------------------------------------
# GET /api/requests/{request_id} — 단건
# ---------------------------------------------------------------------------

@router.get("/api/requests/{request_id}", response_model=RequestResponse)
async def get_request(
    request_id: int,
    *,
    db: SessionDep,
    current: dict = Depends(get_current_user),
):
    """단건 조회. 소유자 또는 System_Operator만. 무권한은 404(존재 비노출)."""
    row = await _get_request_or_404(db, request_id)
    _ensure_can_access(current, row)
    info = await _user_info_map(db, {row.requester_id})
    name, dept = info.get(row.requester_id, (None, None))
    return await _build_single(db, row, name, dept)


# ---------------------------------------------------------------------------
# PATCH /api/requests/{request_id} — 상태/우선순위/응답/반려 (운영자 전용)
# ---------------------------------------------------------------------------

@router.patch("/api/requests/{request_id}", response_model=RequestResponse)
async def update_request(
    request_id: int,
    body: RequestUpdate,
    background: BackgroundTasks,
    *,
    db: SessionDep,
    current: dict = Depends(require_role(RoleCode.SYSTEM_OPERATOR)),
):
    """요청 상태/우선순위 변경 및 응답/반려 사유 등록. System_Operator 전용.

    rejected로 전환할 때는 reject_reason이 필수(스키마 검증). 부분 수정.
    상태/응답 변경 시 요청자에게 알림 메일.
    """
    row = await _get_request_or_404(db, request_id)

    data = body.model_dump(exclude_unset=True)

    new_status = data.get("status", row.status)
    if new_status == "rejected":
        reason = data.get("reject_reason", row.reject_reason)
        if not (reason and reason.strip()):
            raise ValidationError("반려 시 반려 사유는 필수입니다.")

    # 알림 대상 판단: 상태/응답/반려 변경 시에만 요청자 통지
    notify_keys = {"status", "operator_response", "reject_reason"}
    should_notify = bool(notify_keys & data.keys())

    for field, value in data.items():
        setattr(row, field, value)

    await db.flush()

    meta = {"request_id": row.id, "status": row.status}
    if row.status == "rejected" and row.reject_reason:
        meta["reason"] = row.reject_reason
    await append_audit(
        db,
        action=AuditAction.REQUEST_UPDATE,
        result="success",
        actor_user_id=current["user_id"],
        resource_type="request",
        resource_id=str(row.id),
        meta=meta,
    )

    requester_email = (
        await request_notify.resolve_user_email(db, row.requester_id) if should_notify else None
    )

    await db.commit()
    await db.refresh(row)

    if should_notify and requester_email:
        subject, html_body = request_notify.build_status_update(
            title=row.title,
            status=row.status,
            operator_response=row.operator_response,
            reject_reason=row.reject_reason,
        )
        background.add_task(request_notify.send_notification, subject, [requester_email], html_body)

    info = await _user_info_map(db, {row.requester_id})
    name, dept = info.get(row.requester_id, (None, None))
    return await _build_single(db, row, name, dept)


# ---------------------------------------------------------------------------
# POST /api/requests/{request_id}/comments — 댓글 작성
# ---------------------------------------------------------------------------

@router.post(
    "/api/requests/{request_id}/comments",
    response_model=CommentResponse,
    status_code=201,
)
async def add_comment(
    request_id: int,
    body: CommentCreate,
    background: BackgroundTasks,
    *,
    db: SessionDep,
    current: dict = Depends(get_current_user),
):
    """요청에 댓글 작성. 소유자 또는 운영자만. 상대방에게 알림 메일."""
    row = await _get_request_or_404(db, request_id)
    _ensure_can_access(current, row)

    is_op = _is_operator(current)
    comment = RequestComment(
        request_id=request_id,
        author_user_id=current["user_id"],
        author_label=current.get("name"),
        is_operator=is_op,
        body=body.body,
    )
    db.add(comment)
    await db.flush()

    await append_audit(
        db,
        action=AuditAction.REQUEST_COMMENT,
        result="success",
        actor_user_id=current["user_id"],
        resource_type="request",
        resource_id=str(request_id),
        meta={"request_id": request_id},
    )

    # 알림 대상: 운영자 댓글 → 요청자, 요청자 댓글 → 운영자
    if is_op:
        recipients = [await request_notify.resolve_user_email(db, row.requester_id)]
    else:
        recipients = await request_notify.resolve_operator_emails(db)
    recipients = [r for r in recipients if r]

    await db.commit()
    await db.refresh(comment)

    if recipients:
        subject, html_body = request_notify.build_new_comment(
            title=row.title,
            author_label=current.get("name") or "",
            snippet=body.body[:200],
        )
        background.add_task(request_notify.send_notification, subject, recipients, html_body)

    return _comment_to_response(comment)


# ---------------------------------------------------------------------------
# 첨부 파일
# ---------------------------------------------------------------------------

@router.post(
    "/api/requests/{request_id}/attachments",
    response_model=AttachmentResponse,
    status_code=201,
)
async def upload_attachment(
    request_id: int,
    db: SessionDep,
    current: dict = Depends(get_current_user),
    file: UploadFile = File(...),
):
    """요청에 파일 첨부(에러 캡처/문서 등). 소유자 또는 운영자만.

    파일 본체는 StorageService에 저장하고 DB에는 상대 경로/메타만 보관한다.
    """
    row = await _get_request_or_404(db, request_id)
    _ensure_can_access(current, row)

    if not file.filename:
        raise ValidationError("파일 이름이 없습니다.")
    ext = PurePosixPath(file.filename.lower()).suffix
    if ext not in _ALLOWED_EXTS:
        raise ValidationError(
            "허용되지 않는 파일 형식입니다. 이미지/PDF/오피스 문서/텍스트/zip만 첨부할 수 있습니다."
        )

    data = await file.read()
    if not data:
        raise ValidationError("빈 파일은 첨부할 수 없습니다.")
    if len(data) > _max_attachment_bytes():
        raise ValidationError(
            f"파일 크기가 허용치({settings.REQUEST_ATTACHMENT_MAX_MB}MB)를 초과했습니다."
        )

    rel_path = f"request-attachments/{request_id}/{uuid.uuid4().hex}{ext}"
    storage = get_storage_service()
    stored = storage.save(rel_path, data, file.content_type)

    attachment = RequestAttachment(
        request_id=request_id,
        file_name=file.filename,
        storage_path=stored.relative_path,
        mime_type=file.content_type,
        file_size=stored.size,
        uploaded_by_user_id=current["user_id"],
    )
    db.add(attachment)
    await db.flush()

    await append_audit(
        db,
        action=AuditAction.REQUEST_UPDATE,
        result="success",
        actor_user_id=current["user_id"],
        resource_type="request",
        resource_id=str(request_id),
        meta={"request_id": request_id, "target": "attachment_upload"},
    )

    await db.commit()
    await db.refresh(attachment)
    return _attachment_to_response(attachment)


@router.get(
    "/api/requests/{request_id}/attachments",
    response_model=list[AttachmentResponse],
)
async def list_attachments(
    request_id: int,
    *,
    db: SessionDep,
    current: dict = Depends(get_current_user),
):
    """요청 첨부 목록. 소유자 또는 운영자만."""
    row = await _get_request_or_404(db, request_id)
    _ensure_can_access(current, row)

    grouped = await _attachments_map(db, {request_id})
    return [_attachment_to_response(a) for a in grouped.get(request_id, [])]


@router.get("/api/request-attachments/{attachment_id}")
async def download_attachment(
    attachment_id: int,
    db: SessionDep,
    current: dict = Depends(get_current_user),
):
    """첨부 다운로드(권한 검증 스트리밍). 이미지는 inline, 그 외 attachment."""
    attachment = await db.scalar(
        select(RequestAttachment).where(RequestAttachment.id == attachment_id)
    )
    if attachment is None:
        raise NotFoundError("첨부 파일을 찾을 수 없습니다.")

    parent = await _get_request_or_404(db, attachment.request_id)
    _ensure_can_access(current, parent)

    storage = get_storage_service()
    try:
        file_obj = storage.open(attachment.storage_path)
    except FileNotFoundError:
        raise NotFoundError("첨부 파일이 저장소에 없습니다.")

    mime = attachment.mime_type or "application/octet-stream"
    disposition = "inline" if _is_image(mime, attachment.file_name) else "attachment"
    fname = quote(attachment.file_name)
    return StreamingResponse(
        file_obj,
        media_type=mime,
        headers={"Content-Disposition": f"{disposition}; filename*=UTF-8''{fname}"},
    )


@router.delete("/api/request-attachments/{attachment_id}", status_code=204)
async def delete_attachment(
    attachment_id: int,
    db: SessionDep,
    current: dict = Depends(get_current_user),
):
    """첨부 삭제. 소유자 또는 운영자만. 저장소 파일도 삭제."""
    attachment = await db.scalar(
        select(RequestAttachment).where(RequestAttachment.id == attachment_id)
    )
    if attachment is None:
        raise NotFoundError("첨부 파일을 찾을 수 없습니다.")

    parent = await _get_request_or_404(db, attachment.request_id)
    _ensure_can_access(current, parent)

    storage = get_storage_service()
    storage.delete(attachment.storage_path)
    await db.delete(attachment)
    await db.commit()
