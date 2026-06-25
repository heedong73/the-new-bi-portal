"""Mail Dispatch — Celery Beat cron 트리거 (T-31).

design.md "Celery Beat cron_expr 기반 트리거"(R16.12) 참조.

Beat 가 주기적으로 dispatch_due_mail_schedules 를 호출하면, enabled 스케줄 중
현재 시각에 발화해야 하는 것을 골라 회차 run_key 와 함께 bip.mail_job 을 enqueue 한다.
run_key 는 (스케줄, 발화 분) 단위로 고정되어 같은 분의 중복 트리거를 멱등 차단한다
(Mail_Job UNIQUE(mail_schedule_id, run_key) + Redis 락).
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from croniter import croniter
from sqlalchemy import select

from app.core.logging import get_logger
from app.core.timezone import get_app_tz
from app.db.session import AsyncSessionLocal
from app.models.mail import MailSchedule
from app.services.holiday_service import is_business_day
from app.workers.celery_app import celery_app

logger = get_logger(__name__)


def run_key_for(now: datetime) -> str:
    """발화 분 단위 run_key (회차 식별). 같은 분 트리거는 동일 키로 멱등 처리."""
    return now.strftime("%Y%m%dT%H%MZ")


def _is_due(cron_expr: str, now: datetime, window_sec: int = 60) -> bool:
    """cron_expr 기준으로 now(KST) 가 발화 시점인지 판정.

    직전 발화 시각이 [now - window_sec, now] 구간에 들면 due 로 본다.
    Beat 주기(기본 60s)와 맞춰 한 번만 발화하도록 한다.
    """
    try:
        itr = croniter(cron_expr, now)
        prev_fire = itr.get_prev(datetime)
    except (ValueError, KeyError):
        logger.warning("mail_cron_invalid", cron_expr=cron_expr)
        return False
    delta = (now - prev_fire).total_seconds()
    return 0 <= delta < window_sec


async def _dispatch(now: datetime | None = None) -> dict[str, Any]:
    """발화 대상 스케줄을 찾아 mail_job 을 enqueue 한다.

    cron 평가/날짜 판정은 모두 KST(APP_TIMEZONE) 기준. enabled + cron 발화 +
    영업일(스케줄별 skip_weekends/skip_holidays) 조건을 모두 만족할 때만 큐잉한다.
    """
    now = now or datetime.now(tz=get_app_tz())
    today = now.date()
    run_key = run_key_for(now)

    enqueued: list[int] = []
    skipped_non_business: list[int] = []
    async with AsyncSessionLocal() as db:
        schedules = (
            await db.execute(
                select(MailSchedule).where(
                    MailSchedule.enabled.is_(True),
                    MailSchedule.cron_expr.is_not(None),
                )
            )
        ).scalars().all()

        for s in schedules:
            if not _is_due(s.cron_expr, now):
                continue
            # 주말/공휴일 발송 제외 게이트 (KST 기준)
            business = await is_business_day(
                db, today,
                skip_weekends=s.skip_weekends,
                skip_holidays=s.skip_holidays,
            )
            if not business:
                skipped_non_business.append(s.id)
                logger.info("mail_skip_non_business_day",
                            mail_schedule_id=s.id, date=str(today))
                continue
            enqueued.append(s.id)

    for schedule_id in enqueued:
        celery_app.send_task("bip.mail_job", args=[schedule_id, run_key])
        logger.info("mail_job_enqueued", mail_schedule_id=schedule_id, run_key=run_key)

    logger.info(
        "mail_dispatch_done",
        due_count=len(enqueued), skipped=len(skipped_non_business), run_key=run_key,
    )
    return {"due_count": len(enqueued), "run_key": run_key,
            "schedule_ids": enqueued, "skipped_non_business": skipped_non_business}


@celery_app.task(name="bip.dispatch_due_mail_schedules")
def dispatch_due_mail_schedules() -> dict[str, Any]:
    """Beat 진입점: 발화 대상 메일 스케줄을 큐잉한다."""
    return asyncio.run(_dispatch())
