"""Feature: the-new-bi-portal — 메일 멀티페이지 파이프라인 불변식 (T-31).

Property 7: P개 페이지를 가진 메일 스케줄을 실행하면
  - 정확히 P개의 Export_Job 이 생성되고
  - 정확히 P개의 원본(variant=original) Report_Image_Path 가 저장된다.

Property 8 (example): 일부 페이지 실패 시
  - Mail_Job status=failed 이고 failure_reason 이 기록된다.

비고: 파이프라인(_execute_mail_job)은 자체 AsyncSessionLocal 세션으로 커밋하므로
본 테스트는 롤백 격리(conftest db fixture)를 쓰지 않고, 앱 세션으로 직접 커밋한 뒤
생성된 행을 finally 에서 정리한다. mock 모드(APP_MODE=mock)로 외부 호출은 없다.
락 래퍼(_run_mail_job, Redis 의존)는 우회하고 본 파이프라인을 직접 호출한다.
"""
from __future__ import annotations

import asyncio
import tempfile
import uuid

import pytest
from hypothesis import HealthCheck, given, settings as h_settings, strategies as st
from sqlalchemy import delete, func, select

from app.core.config import settings
from app.core.constants import ExportStatus, ImageVariant, MailJobStatus
from app.db.session import AsyncSessionLocal, engine
from app.models.auth import User
from app.models.mail import (
    ExportJob,
    MailJob,
    MailRecipient,
    MailSchedule,
    MailSchedulePage,
    ReportImagePath,
)
from app.models.report import Report, Workspace
from app.workers.tasks import mail_job as mj

# 저장소 루트를 테스트용 임시 디렉터리로 지정 (실제 파일 쓰기 격리)
settings.STORAGE_ROOT_PATH = tempfile.mkdtemp(prefix="bip_test_storage_")


async def _seed(db, num_pages: int) -> tuple[int, int, str]:
    """workspace/report/schedule/pages/recipient 시드. (schedule_id, report_id, ws_id)."""
    ws_id = f"ws-{uuid.uuid4().hex[:12]}"
    db.add(Workspace(workspace_id=ws_id, workspace_name="테스트 WS"))
    await db.flush()

    report = Report(
        workspace_id=ws_id,
        report_id=f"rpt-{uuid.uuid4().hex[:12]}",
        report_name="테스트 리포트",
        display_name="테스트 리포트",
    )
    db.add(report)
    await db.flush()

    schedule = MailSchedule(
        report_id=report.id,
        title="일일 보고서",
        export_format="PNG",
        enabled=True,
    )
    db.add(schedule)
    await db.flush()

    for i in range(num_pages):
        db.add(MailSchedulePage(
            mail_schedule_id=schedule.id,
            page_name=f"Page{i}",
            sort_order=i,
        ))
    # 발송 성공을 위해 EMAIL 수신자 1명
    db.add(MailRecipient(
        mail_schedule_id=schedule.id,
        recipient_type="EMAIL",
        recipient_id=None,
        email="test@example.com",
    ))
    await db.commit()
    return schedule.id, report.id, ws_id


async def _cleanup(schedule_id: int, report_id: int, ws_id: str) -> None:
    """시드 + 파이프라인이 만든 행을 FK 순서대로 삭제."""
    async with AsyncSessionLocal() as db:
        job_ids = (
            await db.execute(
                select(MailJob.id).where(MailJob.mail_schedule_id == schedule_id)
            )
        ).scalars().all()
        if job_ids:
            await db.execute(
                delete(ReportImagePath).where(ReportImagePath.mail_job_id.in_(job_ids))
            )
            await db.execute(delete(ExportJob).where(ExportJob.mail_job_id.in_(job_ids)))
            await db.execute(delete(MailJob).where(MailJob.id.in_(job_ids)))
        await db.execute(
            delete(MailRecipient).where(MailRecipient.mail_schedule_id == schedule_id)
        )
        await db.execute(
            delete(MailSchedulePage).where(MailSchedulePage.mail_schedule_id == schedule_id)
        )
        await db.execute(delete(MailSchedule).where(MailSchedule.id == schedule_id))
        await db.execute(delete(Report).where(Report.id == report_id))
        await db.execute(delete(Workspace).where(Workspace.workspace_id == ws_id))
        await db.commit()


async def _count(mail_job_id: int) -> tuple[int, int]:
    """(export_jobs 수, original 이미지 수) 반환."""
    async with AsyncSessionLocal() as db:
        exports = await db.scalar(
            select(func.count()).select_from(ExportJob).where(
                ExportJob.mail_job_id == mail_job_id
            )
        )
        originals = await db.scalar(
            select(func.count()).select_from(ReportImagePath).where(
                ReportImagePath.mail_job_id == mail_job_id,
                ReportImagePath.variant == ImageVariant.ORIGINAL,
            )
        )
    return int(exports), int(originals)


async def _run_property7(num_pages: int) -> None:
    async with AsyncSessionLocal() as db:
        schedule_id, report_id, ws_id = await _seed(db, num_pages)
    try:
        run_key = f"test-{uuid.uuid4().hex}"
        result = await mj._execute_mail_job(schedule_id, run_key)
        assert result["status"] == "succeeded", result
        exports, originals = await _count(result["mail_job_id"])
        assert exports == num_pages, f"export_jobs={exports} expected={num_pages}"
        assert originals == num_pages, f"originals={originals} expected={num_pages}"
    finally:
        await _cleanup(schedule_id, report_id, ws_id)
        # asyncio.run 마다 새 이벤트 루프가 생성되므로 풀을 비워 교차-루프 충돌 방지
        await engine.dispose()


@given(num_pages=st.integers(min_value=1, max_value=4))
@h_settings(max_examples=6, deadline=None,
            suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_property7_multipage_counts(num_pages):
    """P개 페이지 → P개 export_jobs + P개 original 이미지."""
    asyncio.run(_run_property7(num_pages))


@pytest.mark.asyncio
async def test_property8_partial_failure(monkeypatch):
    """일부 페이지 실패 시 Mail_Job=failed + failure_reason 기록."""
    async with AsyncSessionLocal() as db:
        schedule_id, report_id, ws_id = await _seed(db, 2)

    # 2번째 페이지 폴링을 Failed 로 만들어 부분 실패 유발
    call_count = {"n": 0}
    orig_poll = mj.poll_until_done

    class _Failed:
        status = "Failed"

    async def fake_poll(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 2:
            return _Failed()
        return await orig_poll(*args, **kwargs)

    monkeypatch.setattr(mj, "poll_until_done", fake_poll)

    try:
        run_key = f"test-{uuid.uuid4().hex}"
        result = await mj._execute_mail_job(schedule_id, run_key)
        assert result["status"] == "failed", result
        async with AsyncSessionLocal() as db:
            job = await db.scalar(
                select(MailJob).where(MailJob.id == result["mail_job_id"])
            )
            assert job is not None
            assert job.status == MailJobStatus.FAILED
            assert job.failure_reason
    finally:
        await _cleanup(schedule_id, report_id, ws_id)
        await engine.dispose()
