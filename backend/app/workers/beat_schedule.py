"""Celery Beat 스케줄 — 주기 작업 정의."""
from __future__ import annotations

from celery.schedules import crontab

from app.core.config import settings

beat_schedule = {
    "collect-workspace-every-interval": {
        "task": "bip.collect_workspace",
        "schedule": settings.COLLECT_INTERVAL_MINUTES * 60,
        "args": [settings.POWERBI_WORKSPACE_ID],
    },
    "dispatch-due-mail-schedules-every-minute": {
        "task": "bip.dispatch_due_mail_schedules",
        "schedule": 60.0,
        "args": [],
    },
    "retention-cleanup-daily": {
        "task": "bip.retention_cleanup",
        "schedule": 24 * 60 * 60.0,  # 하루 1회
        "args": [],
    },
}
