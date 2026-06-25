"""Refresh query endpoints.

Design reference: "API 엔드포인트 명세" (``GET /api/refresh-history``,
``GET /api/refresh-timetable``), "공통 오류 응답".

- ``GET /api/refresh-history?date=YYYY-MM-DD`` — the day's Refresh_Runs
  (APP_TIMEZONE date basis) — R9.1.
- ``GET /api/refresh-timetable?from&to&status&reportId&datasetId`` — Refresh_Runs
  matching the optional filters; ``from``/``to`` are ISO 8601, ``status`` is the
  normalized enum — R9.2.

All join/transform/filter logic lives in ``services/refresh_query.py``; these
routes only parse + validate input and delegate. As of stage 3.5 the queries
read from PostgreSQL (the route injects ``SessionDep`` instead of the
``PowerBIClient``); the endpoint paths, query params, and ``RefreshRunOut``
response schema are unchanged (R2.6). Invalid ``date``/``from``/``to`` formats
and unknown ``status`` values return HTTP 400 with the standard
``VALIDATION_ERROR`` envelope (Korean message) — R9.6. The standalone global
handlers are formalized in stage 2.8; here we return the envelope directly via
``JSONResponse`` to keep the response shape consistent now.

**Caching (stage 4.4, R11.2):** both endpoints cache their response in Redis
under the ``prm:cache:*`` keys defined in design.md "Redis 키/TTL 규약". On a
request the route builds the cache key, checks ``get_cached_runs`` first, and on
a hit returns it without touching the DB; on a miss it runs the DB query and
stores the result with ``CACHE_TTL_SECONDS`` TTL. Cache access is best-effort —
a Redis failure falls back to the DB query (see ``services/cache.py``).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import get_args

from fastapi import APIRouter, Query, Response, status
from fastapi.responses import JSONResponse

from app.core.deps import RedisDep, SessionDep, SettingsDep
from app.schemas.common import ErrorResponse
from app.schemas.refresh import RefreshRunOut, RefreshStatus
from app.services import cache, refresh_query

router = APIRouter(tags=["refresh"])

# Allowed normalized status values (success / failed / in_progress / unknown).
_VALID_STATUSES: tuple[str, ...] = get_args(RefreshStatus)


def _validation_error(description: str) -> JSONResponse:
    """Build a 400 response with the standard ``VALIDATION_ERROR`` envelope."""
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content=ErrorResponse(
            errorCode="VALIDATION_ERROR",
            errorDescription=description,
        ).model_dump(),
    )


def _parse_date(value: str) -> date:
    """Parse a ``YYYY-MM-DD`` string, raising ``ValueError`` on bad input."""
    return datetime.strptime(value, "%Y-%m-%d").date()


def _parse_iso(value: str) -> datetime:
    """Parse an ISO 8601 datetime string, raising ``ValueError`` on bad input."""
    return datetime.fromisoformat(value)


@router.get(
    "/refresh-history",
    response_model=list[RefreshRunOut],
    responses={400: {"model": ErrorResponse}},
)
async def get_refresh_history(
    session: SessionDep,
    settings: SettingsDep,
    redis: RedisDep,
    date: str = Query(..., description="조회 일자 (YYYY-MM-DD, APP_TIMEZONE 기준)"),
) -> Response | list[RefreshRunOut]:
    """Return the day's Refresh_Runs (R9.1).

    ``date`` must be ``YYYY-MM-DD``; otherwise HTTP 400 (R9.6). The response is
    cached in Redis under ``prm:cache:refresh-history:{date}`` for
    ``CACHE_TTL_SECONDS`` (R11.2); a cache hit skips the DB query.
    """
    try:
        target_date = _parse_date(date)
    except ValueError:
        return _validation_error("date는 YYYY-MM-DD 형식이어야 합니다.")

    cache_key = cache.history_cache_key(target_date)
    cached = await cache.get_cached_runs(redis, cache_key)
    if cached is not None:
        return cached

    runs = await refresh_query.query_refresh_history(
        session, settings.POWERBI_WORKSPACE_ID, target_date=target_date
    )
    await cache.set_cached_runs(redis, cache_key, runs, settings.CACHE_TTL_SECONDS)
    return runs


@router.get(
    "/refresh-timetable",
    response_model=list[RefreshRunOut],
    responses={400: {"model": ErrorResponse}},
)
async def get_refresh_timetable(
    session: SessionDep,
    settings: SettingsDep,
    redis: RedisDep,
    from_: str | None = Query(
        default=None, alias="from", description="시작 일시 (ISO 8601)"
    ),
    to: str | None = Query(default=None, description="종료 일시 (ISO 8601)"),
    status_: str | None = Query(
        default=None, alias="status", description="상태 (success/failed/in_progress/unknown)"
    ),
    reportId: str | None = Query(default=None, description="Report 식별자"),
    datasetId: str | None = Query(default=None, description="Dataset 식별자"),
) -> Response | list[RefreshRunOut]:
    """Return Refresh_Runs matching the optional filters (R9.2).

    ``from``/``to`` must be ISO 8601 and ``status`` must be a valid enum value;
    otherwise HTTP 400 (R9.6). All parameters are optional. The response is
    cached in Redis under ``prm:cache:refresh-timetable:{hash(query)}`` for
    ``CACHE_TTL_SECONDS`` (R11.2); a cache hit skips the DB query.
    """
    from_dt: datetime | None = None
    to_dt: datetime | None = None

    if from_ is not None:
        try:
            from_dt = _parse_iso(from_)
        except ValueError:
            return _validation_error("from은 ISO 8601 형식이어야 합니다.")

    if to is not None:
        try:
            to_dt = _parse_iso(to)
        except ValueError:
            return _validation_error("to는 ISO 8601 형식이어야 합니다.")

    if status_ is not None and status_ not in _VALID_STATUSES:
        return _validation_error(
            "status는 success, failed, in_progress, unknown 중 하나여야 합니다."
        )

    # Cache key is built from the (validated) raw params in a stable order, so
    # equivalent requests share a cache entry regardless of query ordering.
    cache_key = cache.timetable_cache_key(
        from_=from_,
        to=to,
        status=status_,
        report_id=reportId,
        dataset_id=datasetId,
    )
    cached = await cache.get_cached_runs(redis, cache_key)
    if cached is not None:
        return cached

    runs = await refresh_query.query_refresh_timetable(
        session,
        settings.POWERBI_WORKSPACE_ID,
        from_dt=from_dt,
        to_dt=to_dt,
        status=status_,  # type: ignore[arg-type]  # validated against _VALID_STATUSES
        report_id=reportId,
        dataset_id=datasetId,
    )
    await cache.set_cached_runs(redis, cache_key, runs, settings.CACHE_TTL_SECONDS)
    return runs
