"""공휴일 관리 API — /api/holidays (System_Operator 전용).

GET    /api/holidays            — 공휴일 목록 (연도 필터)
POST   /api/holidays            — 공휴일 추가 (사내 공휴일 등)
DELETE /api/holidays/{id}       — 공휴일 삭제
POST   /api/holidays/seed       — 국가/대체 공휴일 자동 시드(holidays 라이브러리)
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.core.constants import AuditAction, RoleCode
from app.core.deps import SessionDep, require_menu
from app.core.errors import ConflictError, NotFoundError
from app.models.holiday import Holiday
from app.schemas.holiday import (
    HolidayCreate,
    HolidayResponse,
    HolidaySeedRequest,
    HolidaySeedResponse,
)
from app.services.audit_service import append_audit
from app.services.holiday_service import seed_korean_holidays

router = APIRouter(prefix="/api/holidays", tags=["holidays"])

_require_operator = require_menu("admin_holidays")


def _to_response(h: Holiday) -> HolidayResponse:
    return HolidayResponse(
        id=h.id, holiday_date=h.holiday_date, name=h.name,
        holiday_type=h.holiday_type, is_recurring=h.is_recurring, created_at=h.created_at,
    )


@router.get("", response_model=list[HolidayResponse])
async def list_holidays(
    year: int | None = Query(default=None, ge=2000, le=2100),
    *,
    db: SessionDep,
    _op=Depends(_require_operator),
):
    """공휴일 목록 (연도 지정 시 해당 연도만, 매년 반복은 항상 포함)."""
    stmt = select(Holiday).order_by(Holiday.holiday_date)
    if year is not None:
        from sqlalchemy import extract, or_
        stmt = stmt.where(
            or_(extract("year", Holiday.holiday_date) == year, Holiday.is_recurring.is_(True))
        )
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_response(h) for h in rows]


@router.post("", response_model=HolidayResponse, status_code=201)
async def create_holiday(body: HolidayCreate, *, db: SessionDep, op=Depends(_require_operator)):
    """공휴일 추가. 동일 날짜가 이미 있으면 409."""
    dup = await db.scalar(select(Holiday).where(Holiday.holiday_date == body.holiday_date))
    if dup is not None:
        raise ConflictError("해당 날짜의 공휴일이 이미 등록되어 있습니다.")
    holiday = Holiday(
        holiday_date=body.holiday_date, name=body.name,
        holiday_type=body.holiday_type, is_recurring=body.is_recurring,
    )
    db.add(holiday)
    await db.flush()
    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=op["user_id"], actor_label=op["emp_no"],
        resource_type="holiday", resource_id=str(holiday.id),
        meta={"target": "holiday_create"},
    )
    await db.commit()
    return _to_response(holiday)


@router.delete("/{holiday_id}", status_code=204)
async def delete_holiday(holiday_id: int, *, db: SessionDep, op=Depends(_require_operator)):
    """공휴일 삭제."""
    holiday = await db.scalar(select(Holiday).where(Holiday.id == holiday_id))
    if holiday is None:
        raise NotFoundError("공휴일을 찾을 수 없습니다.")
    await db.delete(holiday)
    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=op["user_id"], actor_label=op["emp_no"],
        resource_type="holiday", resource_id=str(holiday_id),
        meta={"target": "holiday_delete"},
    )
    await db.commit()


@router.post("/seed", response_model=HolidaySeedResponse)
async def seed_holidays(body: HolidaySeedRequest, *, db: SessionDep, op=Depends(_require_operator)):
    """국가/대체 공휴일 자동 시드 (기존 날짜는 보존). 관리자 트리거."""
    added = await seed_korean_holidays(db, body.year)
    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=op["user_id"], actor_label=op["emp_no"],
        resource_type="holiday", resource_id=str(body.year),
        meta={"target": "holiday_seed", "count": added},
    )
    await db.commit()
    return HolidaySeedResponse(year=body.year, added=added)
