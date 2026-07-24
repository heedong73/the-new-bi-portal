"""감사 로그 조회 API (T-32).

GET /api/audit-logs — 기간/주체/행위/대상/결과 필터 (System_Operator 전용).
GET /api/audit-logs/actions — 필터 드롭다운용 행위(action) 목록.

design.md "감사 로그 설계"(R35, R38) 참조. 조회 전용(append-only 원장).
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.core.deps import SessionDep, require_menu
from app.models.log import AuditLog
from app.schemas.audit import AuditLogResponse

router = APIRouter(tags=["audit-logs"])

_require_audit = require_menu("audit_logs")


@router.get("/api/audit-logs", response_model=list[AuditLogResponse])
async def list_audit_logs(
    from_: datetime | None = Query(default=None, alias="from", description="시작 시각(UTC)"),
    to: datetime | None = Query(default=None, description="종료 시각(UTC)"),
    actor_user_id: int | None = Query(default=None, gt=0, description="주체(사용자) 필터"),
    action: str | None = Query(default=None, description="행위 필터"),
    resource_type: str | None = Query(default=None, description="대상 리소스 종류 필터"),
    result: str | None = Query(default=None, description="결과(success/failure) 필터"),
    q: str | None = Query(default=None, description="주체명/대상ID 부분 일치 검색"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    *,
    db: SessionDep,
    current: dict = Depends(_require_audit),
):
    """감사 로그 조회. 최신순 정렬, 기간/주체/행위/대상/결과 필터 + 페이지네이션."""
    stmt = select(AuditLog)
    if from_ is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc >= from_)
    if to is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc <= to)
    if actor_user_id is not None:
        stmt = stmt.where(AuditLog.actor_user_id == actor_user_id)
    if action is not None:
        stmt = stmt.where(AuditLog.action == action)
    if resource_type is not None:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
    if result is not None:
        stmt = stmt.where(AuditLog.result == result)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(AuditLog.actor_label.ilike(pattern) | AuditLog.resource_id.ilike(pattern))

    stmt = stmt.order_by(AuditLog.occurred_at_utc.desc(), AuditLog.id.desc())
    stmt = stmt.limit(limit).offset(offset)

    rows = (await db.execute(stmt)).scalars().all()
    return [AuditLogResponse.from_model(r) for r in rows]


@router.get("/api/audit-logs/actions", response_model=list[str])
async def list_audit_actions(
    *,
    db: SessionDep,
    current: dict = Depends(_require_audit),
):
    """실제 기록된 행위(action) 값 목록(중복 제거, 알파벳순) — 필터 드롭다운용."""
    rows = (
        await db.execute(select(AuditLog.action).distinct().order_by(AuditLog.action))
    ).scalars().all()
    return list(rows)
