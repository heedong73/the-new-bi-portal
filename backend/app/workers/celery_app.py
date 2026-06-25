"""Celery 앱 — Redis broker/result. Worker/Beat 공용 진입점."""
from __future__ import annotations

from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "bip",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "app.workers.tasks.pbix_import",
        "app.workers.tasks.refresh_trigger",
        "app.workers.tasks.collect",
        "app.workers.tasks.export_poll",
        "app.workers.tasks.mail_job",
        "app.workers.tasks.mail_dispatch",
        "app.workers.tasks.retention",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone=settings.APP_TIMEZONE,
    enable_utc=True,
    result_expires=86400,
)

# Beat 스케줄은 tasks 등록 후 import (순환 의존 방지)
from app.workers.beat_schedule import beat_schedule  # noqa: E402
celery_app.conf.beat_schedule = beat_schedule
