"""Dataset metadata schema (Pydantic v2).

Design reference: "API 엔드포인트 명세 - GET /api/datasets". Maps 1:1 with the
Frontend ``DatasetOut`` type (Requirement 8.3).
"""

from __future__ import annotations

from pydantic import BaseModel


class DatasetOut(BaseModel):
    """``GET /api/datasets`` response item."""

    datasetId: str
    datasetName: str
