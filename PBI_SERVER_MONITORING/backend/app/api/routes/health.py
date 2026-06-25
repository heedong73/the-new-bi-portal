"""Health endpoint (``GET /api/health``).

Design reference: "API 엔드포인트 명세 - GET /api/health".

Returns liveness plus the active runtime mode and app version so operational
monitoring can confirm whether the Backend is running in Mock_Mode or Live_Mode
(Requirement 8.1).
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.deps import SettingsDep

router = APIRouter(tags=["health"])


class HealthOut(BaseModel):
    """``GET /api/health`` response (Requirement 8.1)."""

    status: Literal["ok"]
    mode: Literal["mock", "live"]
    version: str


@router.get("/health", response_model=HealthOut)
async def get_health(settings: SettingsDep) -> HealthOut:
    """Return ``{status, mode, version}``.

    ``mode`` is injected from ``Settings.APP_MODE`` so a 200 response doubles as
    a confirmation of the active runtime mode.
    """
    return HealthOut(status="ok", mode=settings.APP_MODE, version="1.0.0")
