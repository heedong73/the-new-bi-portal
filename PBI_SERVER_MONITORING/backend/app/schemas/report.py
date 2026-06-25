"""Report metadata schema (Pydantic v2).

Design reference: "API 엔드포인트 명세 - GET /api/reports". Maps 1:1 with the
Frontend ``ReportOut`` type. Paginated reports have no ``datasetId``; the
route fills ``datasetName`` with "데이터셋 없음" in that case (Requirement 6.3).
"""

from __future__ import annotations

from pydantic import BaseModel


class ReportOut(BaseModel):
    """``GET /api/reports`` response item (Requirement 8.2)."""

    reportId: str
    reportName: str
    datasetId: str | None
    datasetName: str
