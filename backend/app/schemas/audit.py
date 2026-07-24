"""감사 로그 조회 API 스키마 (T-32)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.core.timezone import local_isoformat


class AuditLogResponse(BaseModel):
    """감사 로그 1건 응답."""

    id: int
    actor_user_id: int | None = None
    actor_label: str | None = None
    action: str
    resource_type: str | None = None
    resource_id: str | None = None
    result: str
    occurred_at_utc: datetime
    # 화면 표시용 로컬(APP_TIMEZONE) 시각 문자열. occurred_at_utc는 정렬/필터 기준으로 유지.
    occurred_at_local: str
    ip_address: str | None = None
    meta: dict | None = None

    @classmethod
    def from_model(cls, row) -> "AuditLogResponse":
        """AuditLog ORM 행을 응답으로 변환(occurred_at_local 파생 포함)."""
        return cls(
            id=row.id,
            actor_user_id=row.actor_user_id,
            actor_label=row.actor_label,
            action=row.action,
            resource_type=row.resource_type,
            resource_id=row.resource_id,
            result=row.result,
            occurred_at_utc=row.occurred_at_utc,
            occurred_at_local=local_isoformat(row.occurred_at_utc),
            ip_address=row.ip_address,
            meta=row.meta,
        )
