"""감사 로그 조회 API (T-32).

GET /api/audit-logs — 기간/주체/행위 필터 (System_Operator 전용).

design.md "감사 로그 설계"(R35, R38) 참조. 조회 전용(append-only 원장).
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.core.constants import RoleCode
from app.core.deps import SessionDep, require_role
from app.models.log import AuditLog
from app.schemas.audit import AuditLogResponse

router = APIRouter(tags=["audit-logs"])


@router.get("/api/audit-logs", response_model=list[AuditLogResponse])
async def list_audit_logs(
    from_: datetime | None = Query(default=None, alias="from", description="시작 시각(UTC)"),
    to: datetime | None = Query(default=None, description="종료 시각(UTC)"),
    actor_user_id: int | None = Query(default=None, gt=0, description="주체(사용자) 필터"),
    action: str | None = Query(default=None, description="행위 필터"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    *,
    db: SessionDep,
    current: dict = Depends(require_role(RoleCode.SYSTEM_OPERATOR)),
):
    """감사 로그 조회. 최신순 정렬, 기간/주체/행위 필터 + 페이지네이션."""
    stmt = select(AuditLog).order_by(AuditLog.occurred_at_utc.desc(), AuditLog.id.desc())
    if from_ is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc >= from_)
    if to is not None:
        stmt = stmt.where(AuditLog.occurred_at_utc <= to)
    if actor_user_id is not None:
        stmt = stmt.where(AuditLog.actor_user_id == actor_user_id)
    if action is not None:
        stmt = stmt.where(AuditLog.action == action)
    stmt = stmt.limit(limit).offset(offset)

    rows = (await db.execute(stmt)).scalars().all()
    return [
        AuditLogResponse(
            id=r.id, actor_user_id=r.actor_user_id, actor_label=r.actor_label,
            action=r.action, resource_type=r.resource_type, resource_id=r.resource_id,
            result=r.result, occurred_at_utc=r.occurred_at_utc, meta=r.meta,
        )
        for r in rows
    ]
