"""저장 이미지 다운로드 권한 통합 테스트."""
from __future__ import annotations

import tempfile
import uuid

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from app.core.config import settings
from app.core.deps import get_current_user
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.models.mail import (
    MailJob, MailSchedule, ReportImagePath,
)
from app.models.report import Report, Workspace
from app.services.storage_service import get_storage_service

# 저장소 루트를 테스트용 임시 디렉터리로 (실제 파일 쓰기 격리)
settings.STORAGE_ROOT_PATH = tempfile.mkdtemp(prefix="bip_test_imgs_")

OPERATOR = {"user_id": 970001, "emp_no": "OP", "name": "운영자",
            "roles": ["System_Operator"], "is_active": True}
GENERAL = {"user_id": 970002, "emp_no": "G", "name": "일반",
           "roles": ["General_User"], "is_active": True}


@pytest_asyncio.fixture(autouse=True)
async def _cleanup():
    yield
    app.dependency_overrides.pop(get_current_user, None)
    await engine.dispose()


async def _client(user: dict) -> AsyncClient:
    app.dependency_overrides[get_current_user] = lambda: user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _seed_image() -> tuple[int, int, str, str]:
    """workspace+report+schedule+mail_job+image 시드. (image_id, report_id, ws_id, rel_path)."""
    ws_id = f"ws-{uuid.uuid4().hex[:10]}"
    rel_path = f"reportimage/test/{uuid.uuid4().hex}.png"
    get_storage_service().save(rel_path, b"\x89PNG\r\n\x1a\n_fake_png_", "image/png")
    async with AsyncSessionLocal() as db:
        db.add(Workspace(workspace_id=ws_id, workspace_name="WS"))
        await db.flush()
        report = Report(workspace_id=ws_id, report_id=f"r-{uuid.uuid4().hex[:8]}",
                        report_name="R", display_name="R", is_published=True)
        db.add(report)
        await db.flush()
        sched = MailSchedule(report_id=report.id, title="T", export_format="PNG", enabled=True)
        db.add(sched)
        await db.flush()
        job = MailJob(mail_schedule_id=sched.id, run_key=f"k-{uuid.uuid4().hex[:8]}", status="succeeded")
        db.add(job)
        await db.flush()
        img = ReportImagePath(mail_job_id=job.id, page_name="P1", variant="original",
                              image_path=rel_path, file_name="p1.png", mime_type="image/png")
        db.add(img)
        await db.flush()
        ids = (img.id, report.id, ws_id, rel_path)
        await db.commit()
    return ids


async def _cleanup_image(report_id: int, ws_id: str, rel_path: str) -> None:
    async with AsyncSessionLocal() as db:
        # mail_job/image는 schedule CASCADE 또는 직접 삭제
        from sqlalchemy import select
        sched_ids = (await db.execute(
            select(MailSchedule.id).where(MailSchedule.report_id == report_id)
        )).scalars().all()
        job_ids = []
        for sid in sched_ids:
            job_ids += (await db.execute(
                select(MailJob.id).where(MailJob.mail_schedule_id == sid)
            )).scalars().all()
        if job_ids:
            await db.execute(delete(ReportImagePath).where(ReportImagePath.mail_job_id.in_(job_ids)))
            await db.execute(delete(MailJob).where(MailJob.id.in_(job_ids)))
        await db.execute(delete(MailSchedule).where(MailSchedule.report_id == report_id))
        await db.execute(delete(Report).where(Report.id == report_id))
        await db.execute(delete(Workspace).where(Workspace.workspace_id == ws_id))
        await db.commit()
    try:
        get_storage_service().delete(rel_path)
    except Exception:
        pass
    await engine.dispose()


async def test_operator_can_download_image():
    image_id, report_id, ws_id, rel_path = await _seed_image()
    try:
        client = await _client(OPERATOR)
        async with client:
            r = await client.get(f"/api/report-images/{image_id}")
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("image/png")
            assert b"PNG" in r.content
    finally:
        await _cleanup_image(report_id, ws_id, rel_path)


async def test_general_user_without_permission_forbidden():
    image_id, report_id, ws_id, rel_path = await _seed_image()
    try:
        client = await _client(GENERAL)
        async with client:
            r = await client.get(f"/api/report-images/{image_id}")
            assert r.status_code == 403
    finally:
        await _cleanup_image(report_id, ws_id, rel_path)


async def test_missing_image_404():
    client = await _client(OPERATOR)
    async with client:
        r = await client.get("/api/report-images/99999999")
        assert r.status_code == 404
