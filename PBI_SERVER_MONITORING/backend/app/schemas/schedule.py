"""Refresh schedule schema (Pydantic v2).

Design reference: "API 엔드포인트 명세 - GET /api/refresh-schedules". Maps 1:1
with the Frontend ``ScheduleOut`` type (Requirement 8.4).
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ScheduleOut(BaseModel):
    """``GET /api/refresh-schedules`` response item.

    Example: ``{"datasetId": "...", "datasetName": "...",
    "days": ["Monday", "Tuesday"], "times": ["07:00", "13:00"],
    "timezone": "Asia/Seoul", "enabled": true}``.
    """

    datasetId: str
    datasetName: str
    days: list[str] = Field(default_factory=list, description="예약 요일")
    times: list[str] = Field(default_factory=list, description="예약 시각 (HH:MM)")
    timezone: str
    enabled: bool
