"""Summary aggregation service (``/api/summary``).

Design reference: "API 엔드포인트 명세 - GET /api/summary".

Aggregates a list of ``RefreshRunOut`` (already fanned out to Report
granularity and filtered to a day) into a ``SummaryOut`` (Requirement 9.5):

- ``total`` / ``success`` / ``failed`` / ``inProgress`` counts.
- ``averageDurationSeconds``: mean ``durationSeconds`` of **completed** runs
  (success + failed); in-progress runs are excluded so their ever-growing
  elapsed time does not skew the average.
- ``longestRun``: the run with the maximum ``durationSeconds`` (reportName +
  durationSeconds).
- ``lastCompletedAtLocal``: the maximum ``endTimeLocal`` among completed runs.

**Stage note (R2.6):** as of stage 3.5 the runs come from the DB-backed
``query_refresh_history`` (so ``query_summary`` now takes an ``AsyncSession``
instead of a ``PowerBIClient``), but the ``build_summary`` signature and
``SummaryOut`` schema are unchanged so the route keeps the same path and
response shape. ``build_summary`` aggregates in Python over the already
fanned-out + day-filtered ``RefreshRunOut`` list, which keeps the summary
covering exactly the same runs as ``/api/refresh-history``.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.refresh import LongestRun, RefreshRunOut, SummaryOut
from app.services.refresh_query import query_refresh_history


def build_summary(runs: list[RefreshRunOut]) -> SummaryOut:
    """Aggregate Refresh_Runs into a ``SummaryOut`` (Requirement 9.5).

    A run is considered *completed* when its status is ``success`` or
    ``failed`` (i.e. it has finished). ``averageDurationSeconds`` and
    ``lastCompletedAtLocal`` are derived from completed runs only.
    """
    total = len(runs)
    success = sum(1 for r in runs if r.status == "success")
    failed = sum(1 for r in runs if r.status == "failed")
    in_progress = sum(1 for r in runs if r.status == "in_progress")

    completed = [r for r in runs if r.status in ("success", "failed")]

    # Average duration over completed runs with a known duration.
    completed_durations = [
        r.durationSeconds for r in completed if r.durationSeconds is not None
    ]
    average_duration = (
        int(round(sum(completed_durations) / len(completed_durations)))
        if completed_durations
        else 0
    )

    # Longest run across all runs that have a duration.
    longest_run: LongestRun | None = None
    runs_with_duration = [r for r in runs if r.durationSeconds is not None]
    if runs_with_duration:
        longest = max(runs_with_duration, key=lambda r: r.durationSeconds or 0)
        longest_run = LongestRun(
            reportName=longest.reportName,
            durationSeconds=longest.durationSeconds or 0,
        )

    # Most recent completion time (local).
    completed_ends = [r.endTimeLocal for r in completed if r.endTimeLocal is not None]
    last_completed_at_local = max(completed_ends) if completed_ends else None

    return SummaryOut(
        total=total,
        success=success,
        failed=failed,
        inProgress=in_progress,
        averageDurationSeconds=average_duration,
        longestRun=longest_run,
        lastCompletedAtLocal=last_completed_at_local,
    )


async def query_summary(
    session: AsyncSession, workspace_id: str, *, target_date: date
) -> SummaryOut:
    """Build the ``/api/summary`` response for ``target_date`` (R9.5).

    Reuses ``query_refresh_history`` so the summary covers exactly the same
    runs as ``/api/refresh-history`` for that day. As of stage 3.5 the runs are
    read from the DB; an empty day yields a zero-valued summary (not an error).
    """
    runs = await query_refresh_history(session, workspace_id, target_date=target_date)
    return build_summary(runs)
