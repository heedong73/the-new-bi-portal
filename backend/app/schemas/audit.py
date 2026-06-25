"""감사 로그 조회 API 스키마 (T-32)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


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
    meta: dict | None = None
