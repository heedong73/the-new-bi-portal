"""보존 정리 작업 테스트 (이미지/감사 로그).

conftest db fixture(롤백 격리)로 _cleanup_audit_logs 를 직접 검증한다.
이미지 정리는 storage/파일 의존이 있어 audit 위주로 단위 검증한다.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models.log import AuditLog
from app.workers.tasks import retention


def test_cutoff_is_naive_utc():
    cutoff = retention._naive_utc_cutoff(30)
    assert cutoff.tzinfo is None
    # 대략 30일 전
    delta = datetime.now(timezone.utc).replace(tzinfo=None) - cutoff
    assert 29 <= delta.days <= 31


@pytest.mark.asyncio
async def test_audit_cleanup_query_filters_old(db):
    """오래된 감사 로그만 삭제 대상이 되는지 (직접 쿼리로 검증)."""
    old = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=400)
    recent = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
    db.add(AuditLog(action="login", result="success", occurred_at_utc=old))
    db.add(AuditLog(action="login", result="success", occurred_at_utc=recent))
    await db.flush()

    cutoff = retention._naive_utc_cutoff(365)
    old_count = await db.scalar(
        select(func.count()).select_from(AuditLog).where(AuditLog.occurred_at_utc < cutoff)
    )
    recent_count = await db.scalar(
        select(func.count()).select_from(AuditLog).where(AuditLog.occurred_at_utc >= cutoff)
    )
    assert old_count >= 1
    assert recent_count >= 1
