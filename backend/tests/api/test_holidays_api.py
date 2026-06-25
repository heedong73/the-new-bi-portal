"""공휴일 관리 API + dispatch 영업일 게이트 통합 테스트."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app.core.deps import get_current_user
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.models.holiday import Holiday
from app.models.mail import MailSchedule
from app.models.report import Report, Workspace
from app.workers.tasks import mail_dispatch

OPERATOR = {
    "user_id": 990001, "emp_no": "OP", "name": "운영자",
    "roles": ["System_Operator"], "is_active": True,
}


@pytest_asyncio.fixture(autouse=True)
async def _cleanup():
    yield
    app.dependency_overrides.pop(get_current_user, None)
    await engine.dispose()


@pytest_asyncio.fixture
async def client():
    app.dependency_overrides[get_current_user] = lambda: OPERATOR
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_holiday_crud(client):
    d = f"20{uuid.uuid4().int % 90 + 10}-12-31"  # 임의 미래 12/31
    # 생성
    r = await client.post("/api/holidays", json={
        "holiday_date": d, "name": "테스트 사내 공휴일", "holiday_type": "company",
    })
    assert r.status_code == 201, r.text
    hid = r.json()["id"]
    try:
        # 목록
        r = await client.get("/api/holidays")
        assert r.status_code == 200
        assert any(h["id"] == hid for h in r.json())
        # 중복 거부
        r = await client.post("/api/holidays", json={"holiday_date": d, "name": "중복"})
        assert r.status_code == 409
    finally:
        r = await client.delete(f"/api/holidays/{hid}")
        assert r.status_code == 204


async def test_dispatch_skips_holiday():
    """공휴일에는 enabled+발화 스케줄이라도 큐잉되지 않는다."""
    kst = ZoneInfo("Asia/Seoul")
    # 평일 정오 KST 시점을 고른 뒤, 그날을 사내 공휴일로 등록
    now = datetime(2026, 7, 15, 12, 0, 30, tzinfo=kst)  # 수요일 12:00:30
    today = now.date()

    ws_id = f"ws-{uuid.uuid4().hex[:10]}"
    async with AsyncSessionLocal() as db:
        db.add(Workspace(workspace_id=ws_id, workspace_name="WS"))
        await db.flush()
        report = Report(workspace_id=ws_id, report_id=f"r-{uuid.uuid4().hex[:8]}",
                        report_name="R", display_name="R")
        db.add(report)
        await db.flush()
        # 매분 발화 cron → now 에 확실히 due
        sched = MailSchedule(report_id=report.id, title="공휴일테스트",
                             export_format="PNG", enabled=True, cron_expr="* * * * *",
                             skip_weekends=True, skip_holidays=True)
        db.add(sched)
        db.add(Holiday(holiday_date=today, name="임시 사내 공휴일", holiday_type="company"))
        await db.flush()
        sched_id = sched.id
        report_id = report.id
        await db.commit()

    try:
        result = await mail_dispatch._dispatch(now=now)
        assert sched_id in result["skipped_non_business"]
        assert sched_id not in result["schedule_ids"]
    finally:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(MailSchedule).where(MailSchedule.id == sched_id))
            await db.execute(delete(Holiday).where(Holiday.holiday_date == today))
            await db.execute(delete(Report).where(Report.id == report_id))
            await db.execute(delete(Workspace).where(Workspace.workspace_id == ws_id))
            await db.commit()
        await engine.dispose()
