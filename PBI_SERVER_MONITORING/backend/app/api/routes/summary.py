"""Summary endpoint (``GET /api/summary``).

Design reference: "API 엔드포인트 명세 - GET /api/summary", "공통 오류 응답".

Returns the day's aggregate KPIs (total / success / failed / inProgress,
average duration, longest run, last completion time) for ``date`` in
APP_TIMEZONE terms (Requirement 9.5). Aggregation lives in
``services/summary.py``; as of stage 3.5 it reads from PostgreSQL, so this
route injects ``SessionDep`` (the endpoint path and ``SummaryOut`` response
schema are unchanged — R2.6). This route only validates ``date`` and delegates.

Invalid ``date`` returns HTTP 400 with the standard ``VALIDATION_ERROR``
envelope (Korean message) — R9.6.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Query, Response, status
from fastapi.responses import JSONResponse

from app.core.deps import SessionDep, SettingsDep
from app.schemas.common import ErrorResponse
from app.schemas.refresh import SummaryOut
from app.services import summary as summary_service

router = APIRouter(tags=["summary"])


@router.get(
    "/summary",
    response_model=SummaryOut,
    responses={400: {"model": ErrorResponse}},
)
async def get_summary(
    session: SessionDep,
    settings: SettingsDep,
    date: str = Query(..., description="조회 일자 (YYYY-MM-DD, APP_TIMEZONE 기준)"),
) -> Response | SummaryOut:
    """Return the day's summary KPIs (R9.5).

    ``date`` must be ``YYYY-MM-DD``; otherwise HTTP 400 (R9.6).
    """
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content=ErrorResponse(
                errorCode="VALIDATION_ERROR",
                errorDescription="date는 YYYY-MM-DD 형식이어야 합니다.",
            ).model_dump(),
        )

    return await summary_service.query_summary(
        session, settings.POWERBI_WORKSPACE_ID, target_date=target_date
    )
