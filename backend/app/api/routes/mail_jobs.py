"""Mail_Job 이력 조회 + 재시도 API (T-31).

GET  /api/mail-jobs            — 발송 성공/실패 이력 조회 (필터: schedule, status)
POST /api/mail-jobs/{id}/retry — 실패한 잡을 새 회차(run_key)로 재발송 큐잉
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from app.core.constants import MailJobStatus
from app.core.deps import SessionDep, require_menu
from app.core.errors import NotFoundError, ValidationError
from app.core.logging import get_logger
from app.models.mail import MailJob
from app.schemas.mail_job import MailJobResponse, MailJobRetryResponse
from app.workers.celery_app import celery_app

from sqlalchemy import select

logger = get_logger(__name__)
router = APIRouter(tags=["mail-jobs"])


@router.get("/api/mail-jobs", response_model=list[MailJobResponse])
async def list_mail_jobs(
    mail_schedule_id: int | None = Query(default=None, gt=0),
    status: str | None = Query(default=None, description="running/succeeded/failed"),
    limit: int = Query(default=100, ge=1, le=500),
    *,
    db: SessionDep,
    current: dict = Depends(require_menu("mail_jobs")),
):
    """메일 발송 잡 이력 조회. 최신순 정렬, schedule/status 필터 가능."""
    stmt = select(MailJob).order_by(MailJob.id.desc()).limit(limit)
    if mail_schedule_id is not None:
        stmt = stmt.where(MailJob.mail_schedule_id == mail_schedule_id)
    if status is not None:
        stmt = stmt.where(MailJob.status == status)
    jobs = (await db.execute(stmt)).scalars().all()
    return [
        MailJobResponse(
            id=j.id, mail_schedule_id=j.mail_schedule_id, run_key=j.run_key,
            status=j.status, started_at=j.started_at, finished_at=j.finished_at,
            failure_reason=j.failure_reason, retry_count=j.retry_count,
        )
        for j in jobs
    ]


@router.post(
    "/api/mail-jobs/{job_id}/retry",
    response_model=MailJobRetryResponse,
    status_code=202,
)
async def retry_mail_job(
    job_id: int,
    *,
    db: SessionDep,
    current: dict = Depends(require_menu("mail_jobs")),
):
    """실패한 메일 잡을 새 회차로 재발송 큐잉.

    - 실패 상태(failed)만 재시도 가능.
    - 새 run_key(원본 + -retryN)를 부여해 멱등 UNIQUE 제약과 충돌하지 않게 한다.
    - Celery 로 bip.mail_job 을 비동기 enqueue 하고 202 를 반환한다.
    """
    job = await db.scalar(select(MailJob).where(MailJob.id == job_id))
    if job is None:
        raise NotFoundError("메일 잡을 찾을 수 없습니다.")
    if job.status != MailJobStatus.FAILED:
        raise ValidationError("실패한 메일 잡만 재시도할 수 있습니다.")

    next_n = job.retry_count + 1
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    new_run_key = f"{job.run_key}-retry{next_n}-{ts}"

    celery_app.send_task(
        "bip.mail_job",
        args=[job.mail_schedule_id, new_run_key],
    )
    logger.info(
        "mail_job_retry_enqueued",
        mail_job_id=job_id, mail_schedule_id=job.mail_schedule_id,
        new_run_key=new_run_key,
    )
    return MailJobRetryResponse(
        mail_schedule_id=job.mail_schedule_id,
        run_key=new_run_key,
        accepted=True,
        message="재발송 작업이 큐에 등록되었습니다.",
    )
