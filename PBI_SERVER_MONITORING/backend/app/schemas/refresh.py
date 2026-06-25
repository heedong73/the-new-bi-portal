"""Refresh-related response/query schemas (Pydantic v2).

Design reference: "API 엔드포인트 명세" (``RefreshRunOut``, ``SummaryOut``)
and ``GET /api/refresh-timetable`` query parameters.

Field names are intentionally camelCase to map 1:1 with the Frontend types
in ``frontend/src/types/refresh.ts`` (Requirement 9.3). ``datetime`` fields
serialize to ISO 8601 strings via Pydantic v2's default JSON encoder.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

RefreshStatus = Literal["success", "failed", "in_progress", "unknown"]


class RefreshRunOut(BaseModel):
    """Single Refresh_Run response (expanded to Report granularity).

    Mirrors design.md ``RefreshRunOut`` exactly. camelCase field names are
    the serialized JSON keys (matching the Frontend ``RefreshRunOut`` type).
    """

    reportId: str | None
    reportName: str
    datasetId: str | None
    datasetName: str
    refreshType: str | None
    status: RefreshStatus
    startTimeUtc: datetime | None
    endTimeUtc: datetime | None
    startTimeLocal: datetime | None
    endTimeLocal: datetime | None
    scheduledTimeLocal: datetime | None = None
    durationSeconds: int | None
    requestId: str | None
    errorMessage: str | None


class LongestRun(BaseModel):
    """The longest-running Refresh_Run in a ``/api/summary`` window."""

    reportName: str
    durationSeconds: int


class SummaryOut(BaseModel):
    """``GET /api/summary?date=`` response.

    Mirrors design.md "API 엔드포인트 명세 - GET /api/summary".
    """

    total: int
    success: int
    failed: int
    inProgress: int
    averageDurationSeconds: int
    longestRun: LongestRun | None = None
    lastCompletedAtLocal: datetime | None = None


class RefreshTimetableQuery(BaseModel):
    """Query parameters for ``GET /api/refresh-timetable``.

    All parameters are optional. ``from_`` uses ``alias="from"`` because
    ``from`` is a Python reserved keyword; ``populate_by_name=True`` lets the
    route bind either the attribute name or the alias.
    """

    model_config = {"populate_by_name": True}

    from_: datetime | None = Field(default=None, alias="from")
    to: datetime | None = None
    status: RefreshStatus | None = None
    reportId: str | None = None
    datasetId: str | None = None
