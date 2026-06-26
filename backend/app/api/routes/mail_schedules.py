"""메일 스케줄 CRUD API (T-27).

GET    /api/mail-schedules           — 목록
POST   /api/mail-schedules           — 생성 (recipients + pages 복합)
GET    /api/mail-schedules/{id}      — 단건 조회
PATCH  /api/mail-schedules/{id}      — 수정 (부분 수정)
DELETE /api/mail-schedules/{id}      — 삭제
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, delete

from app.core.constants import AuditAction
from app.core.deps import SessionDep, require_menu
from app.core.errors import NotFoundError
from app.models.mail import MailRecipient, MailSchedule, MailSchedulePage
from app.models.report import Report
from app.schemas.mail_schedule import (
    MailScheduleCreate,
    MailScheduleResponse,
    MailScheduleUpdate,
    PageResponse,
    RecipientResponse,
)
from app.services.audit_service import append_audit

router = APIRouter(tags=["mail-schedules"])

# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------

async def _get_schedule_or_404(db: SessionDep, schedule_id: int) -> MailSchedule:
    row = await db.scalar(select(MailSchedule).where(MailSchedule.id == schedule_id))
    if row is None:
        raise NotFoundError("메일 스케줄을 찾을 수 없습니다.")
    return row


async def _build_response(db: SessionDep, schedule: MailSchedule) -> MailScheduleResponse:
    recipients = (
        await db.execute(
            select(MailRecipient)
            .where(MailRecipient.mail_schedule_id == schedule.id)
            .order_by(MailRecipient.id)
        )
    ).scalars().all()

    pages = (
        await db.execute(
            select(MailSchedulePage)
            .where(MailSchedulePage.mail_schedule_id == schedule.id)
            .order_by(MailSchedulePage.sort_order, MailSchedulePage.id)
        )
    ).scalars().all()

    return MailScheduleResponse(
        id=schedule.id,
        report_id=schedule.report_id,
        title=schedule.title,
        subject_template=schedule.subject_template,
        body_header=schedule.body_header,
        body_footer=schedule.body_footer,
        image_width=schedule.image_width,
        image_resize_px=schedule.image_resize_px,
        cron_expr=schedule.cron_expr,
        export_format=schedule.export_format,
        enabled=schedule.enabled,
        skip_weekends=schedule.skip_weekends,
        skip_holidays=schedule.skip_holidays,
        created_at=schedule.created_at,
        recipients=[
            RecipientResponse(
                id=r.id,
                recipient_type=r.recipient_type,
                recipient_id=r.recipient_id,
                email=r.email,
            )
            for r in recipients
        ],
        pages=[
            PageResponse(
                id=p.id,
                page_name=p.page_name,
                caption=p.caption,
                image_width_override=p.image_width_override,
                sort_order=p.sort_order,
            )
            for p in pages
        ],
    )


# ---------------------------------------------------------------------------
# GET /api/mail-schedules — 목록
# ---------------------------------------------------------------------------

@router.get("/api/mail-schedules", response_model=list[MailScheduleResponse])
async def list_mail_schedules(
    report_id: int | None = Query(default=None, gt=0, description="리포트 ID 필터"),
    enabled: bool | None = Query(default=None, description="활성화 여부 필터"),
    *,
    db: SessionDep,
    current: dict = Depends(require_menu("mail_schedules")),
):
    """메일 스케줄 목록 조회. report_id / enabled 로 필터 가능."""
    stmt = select(MailSchedule).order_by(MailSchedule.id)
    if report_id is not None:
        stmt = stmt.where(MailSchedule.report_id == report_id)
    if enabled is not None:
        stmt = stmt.where(MailSchedule.enabled == enabled)

    schedules = (await db.execute(stmt)).scalars().all()
    return [await _build_response(db, s) for s in schedules]


# ---------------------------------------------------------------------------
# POST /api/mail-schedules — 생성
# ---------------------------------------------------------------------------

@router.post("/api/mail-schedules", response_model=MailScheduleResponse, status_code=201)
async def create_mail_schedule(
    body: MailScheduleCreate,
    *,
    db: SessionDep,
    current: dict = Depends(require_menu("mail_schedules")),
):
    """메일 스케줄 생성. recipients / pages 동시 저장."""
    # 연결된 리포트 존재 확인
    report = await db.scalar(select(Report).where(Report.id == body.report_id))
    if report is None:
        raise NotFoundError("리포트를 찾을 수 없습니다.")

    schedule = MailSchedule(
        report_id=body.report_id,
        title=body.title,
        subject_template=body.subject_template,
        body_header=body.body_header,
        body_footer=body.body_footer,
        image_width=body.image_width,
        image_resize_px=body.image_resize_px,
        cron_expr=body.cron_expr,
        export_format=body.export_format,
        enabled=body.enabled,
        skip_weekends=body.skip_weekends,
        skip_holidays=body.skip_holidays,
    )
    db.add(schedule)
    await db.flush()  # id 확보

    # 수신자 저장
    for r in body.recipients:
        db.add(MailRecipient(
            mail_schedule_id=schedule.id,
            recipient_type=r.recipient_type,
            recipient_id=r.recipient_id,
            email=str(r.email) if r.email else None,
        ))

    # 페이지 저장
    for p in body.pages:
        db.add(MailSchedulePage(
            mail_schedule_id=schedule.id,
            page_name=p.page_name,
            caption=p.caption,
            image_width_override=p.image_width_override,
            sort_order=p.sort_order,
        ))

    await db.flush()

    await append_audit(
        db,
        action=AuditAction.MAIL_SCHEDULE_CREATE,
        result="success",
        actor_user_id=current["user_id"],
        resource_type="mail_schedule",
        resource_id=str(schedule.id),
        meta={"mail_schedule_id": schedule.id, "report_id": schedule.report_id},
    )

    await db.commit()
    await db.refresh(schedule)
    return await _build_response(db, schedule)


# ---------------------------------------------------------------------------
# GET /api/mail-schedules/{schedule_id} — 단건
# ---------------------------------------------------------------------------

@router.get("/api/mail-schedules/{schedule_id}", response_model=MailScheduleResponse)
async def get_mail_schedule(
    schedule_id: int,
    *,
    db: SessionDep,
    current: dict = Depends(require_menu("mail_schedules")),
):
    """메일 스케줄 단건 조회."""
    schedule = await _get_schedule_or_404(db, schedule_id)
    return await _build_response(db, schedule)


# ---------------------------------------------------------------------------
# PATCH /api/mail-schedules/{schedule_id} — 수정
# ---------------------------------------------------------------------------

@router.patch("/api/mail-schedules/{schedule_id}", response_model=MailScheduleResponse)
async def update_mail_schedule(
    schedule_id: int,
    body: MailScheduleUpdate,
    *,
    db: SessionDep,
    current: dict = Depends(require_menu("mail_schedules")),
):
    """메일 스케줄 부분 수정.

    - recipients / pages 가 None → 기존 유지
    - recipients / pages 가 [] → 전체 삭제
    - recipients / pages 에 값 → 기존 전체 교체 (삭제 후 재삽입)
    """
    schedule = await _get_schedule_or_404(db, schedule_id)

    # 스칼라 필드 업데이트
    update_data = body.model_dump(
        exclude_unset=True, exclude={"recipients", "pages"}
    )
    for field, value in update_data.items():
        setattr(schedule, field, value)

    # recipients 교체
    if body.recipients is not None:
        await db.execute(
            delete(MailRecipient).where(MailRecipient.mail_schedule_id == schedule_id)
        )
        for r in body.recipients:
            db.add(MailRecipient(
                mail_schedule_id=schedule_id,
                recipient_type=r.recipient_type,
                recipient_id=r.recipient_id,
                email=str(r.email) if r.email else None,
            ))

    # pages 교체
    if body.pages is not None:
        await db.execute(
            delete(MailSchedulePage).where(MailSchedulePage.mail_schedule_id == schedule_id)
        )
        for p in body.pages:
            db.add(MailSchedulePage(
                mail_schedule_id=schedule_id,
                page_name=p.page_name,
                caption=p.caption,
                image_width_override=p.image_width_override,
                sort_order=p.sort_order,
            ))

    await db.flush()

    await append_audit(
        db,
        action=AuditAction.MAIL_SCHEDULE_UPDATE,
        result="success",
        actor_user_id=current["user_id"],
        resource_type="mail_schedule",
        resource_id=str(schedule_id),
        meta={"mail_schedule_id": schedule_id},
    )

    await db.commit()
    await db.refresh(schedule)
    return await _build_response(db, schedule)


# ---------------------------------------------------------------------------
# DELETE /api/mail-schedules/{schedule_id} — 삭제
# ---------------------------------------------------------------------------

@router.delete("/api/mail-schedules/{schedule_id}", status_code=204)
async def delete_mail_schedule(
    schedule_id: int,
    *,
    db: SessionDep,
    current: dict = Depends(require_menu("mail_schedules")),
):
    """메일 스케줄 삭제 (CASCADE 로 recipients, pages 자동 삭제)."""
    schedule = await _get_schedule_or_404(db, schedule_id)

    await append_audit(
        db,
        action=AuditAction.MAIL_SCHEDULE_DELETE,
        result="success",
        actor_user_id=current["user_id"],
        resource_type="mail_schedule",
        resource_id=str(schedule_id),
        meta={"mail_schedule_id": schedule_id, "report_id": schedule.report_id},
    )

    await db.delete(schedule)
    await db.commit()
