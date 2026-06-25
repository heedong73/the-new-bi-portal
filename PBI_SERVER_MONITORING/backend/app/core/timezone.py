"""Timezone conversion helpers (UTC <-> APP_TIMEZONE).

Design reference: "이중 시간 컬럼". Power BI returns UTC; operators read
``APP_TIMEZONE`` (default ``Asia/Seoul``). These helpers provide the basic
round-trip conversion used across the app plus :func:`compute_time_columns`,
which derives the dual UTC/local columns and ``duration_seconds`` for a single
Refresh_Run in one call.

``compute_time_columns`` is the shared entry point used both when the collector
loads a row (stage 3.5) and when ``refresh_query`` shapes the response, so the
two paths can never drift in how they interpret Power BI's raw UTC times.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TypedDict
from zoneinfo import ZoneInfo

from app.core.config import get_settings


class TimeColumns(TypedDict):
    """Dual time columns derived from a single Power BI Refresh_Run.

    Mirrors the ``refresh_runs`` dual-time schema (Requirement 7.1, 7.2):
    ``start_time_*``/``end_time_*`` are stored in both UTC and APP_TIMEZONE,
    and ``duration_seconds`` is the finished-run elapsed time (Requirement 7.3).
    """

    start_time_utc: datetime
    end_time_utc: datetime | None
    start_time_local: datetime
    end_time_local: datetime | None
    duration_seconds: int | None


def get_app_tz() -> ZoneInfo:
    """Return the configured application timezone (``APP_TIMEZONE``)."""
    return ZoneInfo(get_settings().APP_TIMEZONE)


def to_utc(dt: datetime) -> datetime:
    """Return ``dt`` as a tz-aware UTC datetime.

    Naive datetimes are assumed to already be in UTC.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def to_local(dt: datetime, tz: ZoneInfo | None = None) -> datetime:
    """Convert ``dt`` to the application local timezone.

    Naive datetimes are assumed to be UTC before conversion.
    """
    tz = tz or get_app_tz()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz)


def compute_time_columns(
    start: datetime, end: datetime | None, tz: ZoneInfo | None = None
) -> TimeColumns:
    """Derive the dual UTC/local time columns for one Refresh_Run.

    Given Power BI's raw ``start``/``end`` (UTC; naive values are treated as
    UTC per :func:`to_utc`/:func:`to_local`), produce ``start_time_utc``,
    ``end_time_utc``, ``start_time_local``, ``end_time_local`` and
    ``duration_seconds`` in a single call. This is shared by the collector
    (row load, stage 3.5) and ``refresh_query`` (response shaping) so both
    interpret times identically.

    ``duration_seconds`` is computed from the *absolute UTC instants*
    (``end_time_utc - start_time_utc``) as a non-negative integer when ``end``
    is present (Requirement 7.3). When ``end is None`` the run is in progress
    and ``duration_seconds`` is ``None``; the dynamic ``now - start`` elapsed
    time is the caller's responsibility (Requirement 7.4), since "now" belongs
    to the response moment rather than the row.

    Round-trip invariant: because :func:`to_utc`/:func:`to_local` only re-anchor
    the same absolute instant (``ZoneInfo`` conversion), ``start_time_utc`` and
    ``start_time_local`` denote the identical moment, and
    ``to_utc(start_time_local) == start_time_utc`` (verified by Property 3, 3.4).
    """
    tz = tz or get_app_tz()

    start_utc = to_utc(start)
    start_local = to_local(start, tz)

    if end is None:
        return TimeColumns(
            start_time_utc=start_utc,
            end_time_utc=None,
            start_time_local=start_local,
            end_time_local=None,
            duration_seconds=None,
        )

    end_utc = to_utc(end)
    end_local = to_local(end, tz)
    # Absolute-instant elapsed time (UTC basis). Clamp at 0 so an end earlier
    # than start (clock skew / bad data) never yields a negative duration.
    duration_seconds = max(0, int((end_utc - start_utc).total_seconds()))

    return TimeColumns(
        start_time_utc=start_utc,
        end_time_utc=end_utc,
        start_time_local=start_local,
        end_time_local=end_local,
        duration_seconds=duration_seconds,
    )
