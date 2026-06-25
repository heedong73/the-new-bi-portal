"""API 통합 테스트 — Phase 7/8 신규 라우트의 인증/권한/응답 검증.

대상: mail-schedules, mail-jobs, audit-logs, stats, monitoring, health.

인증은 get_current_user 의존성을 override 하여 우회한다(require_role 은 이를 통해
역할을 검사하므로 override 만으로 권한 분기까지 검증된다). 라우트는 자체
AsyncSessionLocal 세션으로 실제 테스트 DB에 접근하므로, 쓰기 테스트는 생성 행을
정리하고, 함수마다 engine 풀을 dispose 하여 이벤트 루프 교차 문제를 피한다.
"""
from __future__ import annotations

import uuid

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app.core.deps import get_current_user
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.models.mail import (
    MailRecipient,
    MailSchedule,
    MailSchedulePage,
)
from app.models.report import Report, Workspace

OPERATOR = {
    "user_id": 999001, "emp_no": "OP1", "name": "운영자",
    "roles": ["System_Operator", "admin", "report_manager"], "is_active": True,
}
GENERAL = {
    "user_id": 999002, "emp_no": "G1", "name": "일반",
    "roles": ["General_User"], "is_active": True,
}


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_overrides_and_engine():
    """각 테스트 후 의존성 override 해제 + engine 풀 dispose (루프 격리)."""
    yield
    app.dependency_overrides.pop(get_current_user, None)
    await engine.dispose()


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def _login_as(user: dict | None) -> None:
    if user is None:
        app.dependency_overrides.pop(get_current_user, None)
    else:
        app.dependency_overrides[get_current_user] = lambda: user


# ── health (익명) ───────────────────────────────────────────────────────────

async def test_health_anonymous(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ── 인증/권한 ────────────────────────────────────────────────────────────────

async def test_protected_requires_auth(client):
    """미인증 시 401."""
    _login_as(None)
    resp = await client.get("/api/stats/overview")
    assert resp.status_code == 401


async def test_non_operator_forbidden(client):
    """비-운영자(General_User)는 운영자 전용 라우트에서 403."""
    _login_as(GENERAL)
    for path in ("/api/audit-logs", "/api/stats/overview", "/api/monitoring/status"):
        resp = await client.get(path)
        assert resp.status_code == 403, f"{path} → {resp.status_code}"


# ── 운영자 GET 엔드포인트 ─────────────────────────────────────────────────────

async def test_operator_get_endpoints(client):
    _login_as(OPERATOR)

    r = await client.get("/api/stats/overview")
    assert r.status_code == 200
    assert "login_count" in r.json() and "failed_job_count" in r.json()

    r = await client.get("/api/stats/usage")
    assert r.status_code == 200
    body = r.json()
    for key in ("top_reports", "reports_by_department", "views_by_department",
                "unused_reports"):
        assert key in body

    r = await client.get("/api/monitoring/status")
    assert r.status_code == 200
    body = r.json()
    for key in ("db", "redis", "worker", "recent_jobs", "recent_failures"):
        assert key in body

    r = await client.get("/api/audit-logs")
    assert r.status_code == 200
    assert isinstance(r.json(), list)

    r = await client.get("/api/mail-jobs")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


async def test_mail_jobs_retry_not_found(client):
    _login_as(OPERATOR)
    resp = await client.post("/api/mail-jobs/999999999/retry")
    assert resp.status_code == 404


# ── mail-schedules CRUD 라운드트립 ────────────────────────────────────────────

async def test_mail_schedule_crud(client):
    _login_as(OPERATOR)

    # 시드: workspace + report (FK 충족)
    ws_id = f"ws-{uuid.uuid4().hex[:12]}"
    async with AsyncSessionLocal() as db:
        db.add(Workspace(workspace_id=ws_id, workspace_name="테스트 WS"))
        await db.flush()
        report = Report(
            workspace_id=ws_id, report_id=f"rpt-{uuid.uuid4().hex[:12]}",
            report_name="리포트", display_name="리포트",
        )
        db.add(report)
        await db.flush()
        report_id = report.id
        await db.commit()

    schedule_id = None
    try:
        # CREATE
        payload = {
            "report_id": report_id,
            "title": "일일 보고서",
            "subject_template": "{date} 보고서",
            "export_format": "PNG",
            "enabled": True,
            "recipients": [
                {"recipient_type": "EMAIL", "email": "a@example.com"},
            ],
            "pages": [
                {"page_name": "Page1", "sort_order": 0},
                {"page_name": "Page2", "sort_order": 1},
            ],
        }
        r = await client.post("/api/mail-schedules", json=payload)
        assert r.status_code == 201, r.text
        created = r.json()
        schedule_id = created["id"]
        assert created["title"] == "일일 보고서"
        assert len(created["recipients"]) == 1
        assert len(created["pages"]) == 2

        # GET 단건
        r = await client.get(f"/api/mail-schedules/{schedule_id}")
        assert r.status_code == 200
        assert r.json()["report_id"] == report_id

        # LIST
        r = await client.get("/api/mail-schedules", params={"report_id": report_id})
        assert r.status_code == 200
        assert any(s["id"] == schedule_id for s in r.json())

        # PATCH (제목 + 페이지 교체)
        r = await client.patch(
            f"/api/mail-schedules/{schedule_id}",
            json={"title": "수정됨", "pages": [{"page_name": "OnlyPage", "sort_order": 0}]},
        )
        assert r.status_code == 200
        patched = r.json()
        assert patched["title"] == "수정됨"
        assert len(patched["pages"]) == 1

        # DELETE
        r = await client.delete(f"/api/mail-schedules/{schedule_id}")
        assert r.status_code == 204
        r = await client.get(f"/api/mail-schedules/{schedule_id}")
        assert r.status_code == 404
        schedule_id = None
    finally:
        # 정리
        async with AsyncSessionLocal() as db:
            if schedule_id is not None:
                await db.execute(delete(MailRecipient).where(
                    MailRecipient.mail_schedule_id == schedule_id))
                await db.execute(delete(MailSchedulePage).where(
                    MailSchedulePage.mail_schedule_id == schedule_id))
                await db.execute(delete(MailSchedule).where(MailSchedule.id == schedule_id))
            await db.execute(delete(Report).where(Report.id == report_id))
            await db.execute(delete(Workspace).where(Workspace.workspace_id == ws_id))
            await db.commit()
