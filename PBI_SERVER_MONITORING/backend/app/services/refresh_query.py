"""Refresh query service — Report ↔ Refresh History fan-out (DB-backed).

Design reference: "Refresh Query Service", "Reports - Refresh History 조인",
"이중 시간 컬럼".

This module is the **read path**. As of stage 3.5 it reads from PostgreSQL
exclusively (the in-memory mock join was removed): the collector
(``services/powerbi/collector.py``) is now responsible for fetching from the
``PowerBIClient`` and upserting normalized rows, while the query side performs
the Report-granularity fan-out with a SQL ``JOIN`` and returns
``RefreshRunOut``.

JOIN shape (design.md "Refresh Query Service")::

    FROM reports rep
    LEFT JOIN datasets ds
        ON ds.workspace_id = rep.workspace_id AND ds.dataset_id = rep.dataset_id
    LEFT JOIN refresh_runs rr
        ON rr.workspace_id = rep.workspace_id AND rr.dataset_id = rep.dataset_id

Fan-out rules (Requirement 6):
- Join key is ``Report.dataset_id == RefreshRun.dataset_id`` (R6.1).
- A dataset shared by N reports yields the *same* M refreshes on every report,
  producing N×M rows; the UI groups by report (R6.2).
- Paginated reports (``dataset_id IS NULL``) match no ``refresh_runs`` row
  (``rr.*`` NULL); such rows are **excluded** from history/timetable results.
  Their "데이터셋 없음" display belongs to ``/api/reports`` (R6.3).

Time rules (Requirement 7):
- ``start_time_utc`` / ``end_time_utc`` and ``start_time_local`` /
  ``end_time_local`` are read from the dual time columns the collector wrote.
- ``durationSeconds`` = stored ``duration_seconds`` when finished; for
  in-progress runs (``duration_seconds IS NULL``) it is computed dynamically in
  SQL as ``EXTRACT(EPOCH FROM (now() - start_time_utc))`` (R7.3, R7.4).

**Stage note (R2.6):** the public function signatures changed from taking a
``PowerBIClient`` to taking an ``AsyncSession`` (queries now read the DB), but
the response schema (``RefreshRunOut``) is unchanged so routes keep the same
endpoint paths, query params, and response shape. Until the collector runs
(stage 5 ``collect-now`` / stage 6 worker) the tables may be empty, in which
case these functions correctly return an empty list (not an error).
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlalchemy import Integer, Row, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import NO_DATASET_NAME
from app.core.timezone import get_app_tz, to_local
from app.models.dataset import Dataset
from app.models.refresh_run import RefreshRun
from app.models.report import Report
from app.schemas.refresh import RefreshRunOut, RefreshStatus

# Dynamic in-progress duration: seconds elapsed since start (R7.4). Truncated to
# an integer to match the stored finished ``duration_seconds`` (R7.3). Both
# columns are TIMESTAMPTZ so ``func.now() - start_time_utc`` is a clean interval.
_DURATION_EXPR = func.coalesce(
    RefreshRun.duration_seconds,
    cast(
        func.extract("epoch", func.now() - RefreshRun.start_time_utc),
        Integer,
    ),
).label("duration_seconds")

# Dataset name resolved from the dataset catalogue, falling back to the
# refresh_runs denormalized copy and finally "데이터셋 없음" so the non-optional
# ``RefreshRunOut.datasetName`` always has a value.
_DATASET_NAME_EXPR = func.coalesce(
    Dataset.dataset_name,
    RefreshRun.dataset_name,
    NO_DATASET_NAME,
).label("dataset_name")


def _base_select(workspace_id: str):
    """Build the base Report ↔ Dataset ↔ Refresh_Run JOIN select.

    Only rows that matched a ``refresh_runs`` row are returned (``rr.request_id
    IS NOT NULL``), which naturally drops paginated reports and reports whose
    dataset has no refresh history yet (R6.3). Ordered by ``start_time_utc``
    descending with NULLs last (design ORDER BY).
    """
    return (
        select(
            Report.report_id.label("report_id"),
            Report.report_name.label("report_name"),
            Report.dataset_id.label("dataset_id"),
            _DATASET_NAME_EXPR,
            RefreshRun.refresh_type.label("refresh_type"),
            RefreshRun.status.label("status"),
            RefreshRun.start_time_utc.label("start_time_utc"),
            RefreshRun.end_time_utc.label("end_time_utc"),
            RefreshRun.start_time_local.label("start_time_local"),
            RefreshRun.end_time_local.label("end_time_local"),
            _DURATION_EXPR,
            RefreshRun.request_id.label("request_id"),
            RefreshRun.error_message.label("error_message"),
        )
        .select_from(Report)
        .join(
            Dataset,
            and_(
                Dataset.workspace_id == Report.workspace_id,
                Dataset.dataset_id == Report.dataset_id,
            ),
            isouter=True,
        )
        .join(
            RefreshRun,
            and_(
                RefreshRun.workspace_id == Report.workspace_id,
                RefreshRun.dataset_id == Report.dataset_id,
            ),
            isouter=True,
        )
        .where(
            Report.workspace_id == workspace_id,
            # Exclude paginated reports / datasets without refreshes (R6.3).
            RefreshRun.request_id.isnot(None),
        )
        .order_by(RefreshRun.start_time_utc.desc().nulls_last())
    )


def _row_to_out(row: Row) -> RefreshRunOut:
    """Map a JOIN result row to a ``RefreshRunOut``.

    ``status`` is already the normalized enum string stored by the collector;
    ``duration_seconds`` is the COALESCE result (finished value or dynamic
    in-progress elapsed). Negative dynamic durations (clock skew) are clamped.
    """
    duration = row.duration_seconds
    if duration is not None and duration < 0:
        duration = 0

    # DB의 *_local 컬럼은 TIMESTAMPTZ라 collector가 KST datetime을 저장해도
    # PostgreSQL이 UTC 절대시각으로 정규화한다. 따라서 *_local 값을 신뢰하지 않고,
    # UTC 절대시각(*_utc)을 APP_TIMEZONE(Asia/Seoul)으로 변환한 값을 응답의
    # local 필드로 사용한다. to_local은 tz-aware(+09:00) datetime을 반환하므로
    # Pydantic이 +09:00 오프셋이 붙은 ISO 문자열로 직렬화한다.
    return RefreshRunOut(
        reportId=row.report_id,
        reportName=row.report_name,
        datasetId=row.dataset_id,
        datasetName=row.dataset_name,
        refreshType=row.refresh_type,
        status=row.status,
        startTimeUtc=row.start_time_utc,
        endTimeUtc=row.end_time_utc,
        startTimeLocal=(
            to_local(row.start_time_utc) if row.start_time_utc is not None else None
        ),
        endTimeLocal=(
            to_local(row.end_time_utc) if row.end_time_utc is not None else None
        ),
        durationSeconds=duration,
        requestId=row.request_id,
        errorMessage=row.error_message,
    )


def _as_app_local(dt: datetime) -> datetime:
    """Return ``dt`` as a tz-aware datetime in APP_TIMEZONE.

    Filter bounds (``from``/``to``) are entered in local terms, so a naive
    bound is interpreted as APP_TIMEZONE; an aware bound is converted to it.
    The comparison against the ``start_time_local`` TIMESTAMPTZ column is on
    the absolute instant, so this keeps local-entered bounds correct.
    """
    tz = get_app_tz()
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


async def query_refresh_history(
    session: AsyncSession, workspace_id: str, *, target_date: date
) -> list[RefreshRunOut]:
    """Return the day's Refresh_Runs (APP_TIMEZONE date basis) — R9.1.

    The day is bounded by ``[D 00:00, D+1 00:00)`` in APP_TIMEZONE and compared
    against ``start_time_local``; this is the SQL equivalent of
    ``startTimeLocal.date() == D`` and is timezone-safe.
    """
    tz = get_app_tz()
    day_start = datetime.combine(target_date, time.min, tzinfo=tz)
    day_end = day_start + timedelta(days=1)

    stmt = _base_select(workspace_id).where(
        RefreshRun.start_time_local >= day_start,
        RefreshRun.start_time_local < day_end,
    )
    result = await session.execute(stmt)
    return [_row_to_out(row) for row in result.all()]


async def query_refresh_timetable(
    session: AsyncSession,
    workspace_id: str,
    *,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
    status: RefreshStatus | None = None,
    report_id: str | None = None,
    dataset_id: str | None = None,
) -> list[RefreshRunOut]:
    """Return Refresh_Runs matching the optional filters — R9.2 / Property 7.

    Each provided predicate is applied; omitted (``None``) ones are skipped:
    - ``from_dt`` / ``to_dt`` compare against ``start_time_local``.
    - ``status`` / ``report_id`` / ``dataset_id`` are exact matches.
    """
    stmt = _base_select(workspace_id)

    if from_dt is not None:
        stmt = stmt.where(RefreshRun.start_time_local >= _as_app_local(from_dt))
    if to_dt is not None:
        stmt = stmt.where(RefreshRun.start_time_local <= _as_app_local(to_dt))
    if status is not None:
        stmt = stmt.where(RefreshRun.status == status)
    if report_id is not None:
        stmt = stmt.where(Report.report_id == report_id)
    if dataset_id is not None:
        stmt = stmt.where(Report.dataset_id == dataset_id)

    result = await session.execute(stmt)
    return [_row_to_out(row) for row in result.all()]
