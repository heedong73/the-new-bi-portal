"""Celery Beat 스케줄 — 주기 작업 정의."""
from __future__ import annotations

from celery.schedules import crontab

from app.core.config import settings

beat_schedule = {
    # 운영 상태 페이지가 Beat → broker → Worker 경로의 생존 여부를 판정한다.
    "scheduler-heartbeat-every-30s": {
        "task": "bip.scheduler_heartbeat",
        "schedule": 30.0,
        "args": [],
    },
    "collect-workspace-every-interval": {
        "task": "bip.collect_workspace",
        "schedule": settings.COLLECT_INTERVAL_MINUTES * 60,
        "args": [settings.POWERBI_WORKSPACE_ID],
    },
    "dispatch-due-mail-schedules-every-30s": {
        "task": "bip.dispatch_due_mail_schedules",
        "schedule": 30.0,
        "args": [],
    },
    "retention-cleanup-daily": {
        "task": "bip.retention_cleanup",
        "schedule": 24 * 60 * 60.0,  # 하루 1회
        "args": [],
    },
}
