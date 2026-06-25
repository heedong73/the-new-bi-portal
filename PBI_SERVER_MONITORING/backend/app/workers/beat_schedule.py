"""Celery Beat schedule — periodic ``prm.collect_workspace`` trigger.

Design reference: "Beat schedule (`workers/beat_schedule.py`)", Requirement 4.7.

The PRM Scheduler (Celery Beat) fires the ``prm.collect_workspace`` task on a
fixed cron interval so refresh history is collected without an operator having
to call ``POST /api/collect-now``. The interval is operator-configurable via the
``COLLECT_INTERVAL_MINUTES`` env var, whose allowed values are **1 or 5**
(Requirement 4.7).

No circular import
------------------
This module deliberately does **not** import ``celery_app``. It only builds a
plain ``beat_schedule`` dict (plus the ``crontab`` schedule object). The
``celery_app`` module imports *this* dict and assigns it to
``celery_app.conf.beat_schedule``. Keeping the dependency one-directional
(``celery_app`` -> ``beat_schedule``) avoids the import cycle that would occur
if both modules imported each other.

Interval validation / fallback
-------------------------------
``COLLECT_INTERVAL_MINUTES`` is validated against the allowed set ``{1, 5}``. If
an out-of-range value is configured (e.g. ``3`` or ``10``), it is clamped to the
nearest allowed value (ties resolve to ``5``, the safer/less aggressive
interval), and a warning is logged. This guarantees Beat always builds a valid
``crontab(minute="*/1")`` or ``crontab(minute="*/5")`` and never crashes on a
bad env value.
"""

from __future__ import annotations

from celery.schedules import crontab

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Allowed collection intervals in minutes (Requirement 4.7).
ALLOWED_INTERVAL_MINUTES: tuple[int, ...] = (1, 5)
# Fallback used when the configured value is outside ALLOWED_INTERVAL_MINUTES.
DEFAULT_INTERVAL_MINUTES: int = 5


def resolve_interval_minutes(configured: int) -> int:
    """Return a valid collection interval (1 or 5) for the configured value.

    - If ``configured`` is already an allowed value (1 or 5), return it as-is.
    - Otherwise clamp to the nearest allowed value; ties resolve to the larger
      (less aggressive) interval, i.e. ``5``. A warning is logged so operators
      can see their ``COLLECT_INTERVAL_MINUTES`` was overridden.
    """
    if configured in ALLOWED_INTERVAL_MINUTES:
        return configured

    # Pick the allowed value with the smallest distance; on a tie prefer the
    # larger interval (max) so we fall back to the safer 5-minute cadence.
    nearest = min(
        ALLOWED_INTERVAL_MINUTES,
        key=lambda allowed: (abs(allowed - configured), -allowed),
    )
    logger.warning(
        "collect_interval_invalid_fallback",
        configured=configured,
        allowed=list(ALLOWED_INTERVAL_MINUTES),
        using=nearest,
    )
    return nearest


def build_beat_schedule() -> dict:
    """Build the Celery Beat schedule dict from current settings.

    Produces a single entry, ``collect-every-N-minutes``, that triggers
    ``prm.collect_workspace`` every N minutes (N = validated
    ``COLLECT_INTERVAL_MINUTES``) with ``POWERBI_WORKSPACE_ID`` as the only
    positional arg — matching the collect task signature
    ``collect_workspace(self, workspace_id)``.
    """
    settings = get_settings()
    interval = resolve_interval_minutes(settings.COLLECT_INTERVAL_MINUTES)
    return {
        "collect-every-N-minutes": {
            "task": "prm.collect_workspace",
            # crontab(minute="*/1") or crontab(minute="*/5") (Requirement 4.7).
            "schedule": crontab(minute=f"*/{interval}"),
            "args": [settings.POWERBI_WORKSPACE_ID],
        }
    }


# Module-level dict imported by celery_app and assigned to conf.beat_schedule.
beat_schedule: dict = build_beat_schedule()
