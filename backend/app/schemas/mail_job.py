"""Mail_Job 조회/재시도 API 스키마 (T-31)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class MailJobResponse(BaseModel):
    """메일 발송 잡 이력 응답."""

    id: int
    mail_schedule_id: int
    run_key: str
    status: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    failure_reason: str | None = None
    retry_count: int


class MailJobRetryResponse(BaseModel):
    """재시도 요청 수락 응답 (202). 새 회차의 run_key 반환."""

    mail_schedule_id: int
    run_key: str
    accepted: bool
    message: str
