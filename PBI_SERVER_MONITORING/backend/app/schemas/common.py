"""Common response/error schemas (Pydantic v2).

Design reference: "공통 오류 응답". All error responses across ``/api/*``
share the ``{errorCode, errorDescription}`` envelope so the Frontend can
surface a single, human-readable Korean message (Requirement 19.1, 19.2).
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    """Standard error envelope for all ``/api/*`` failures.

    Matches the design.md "공통 오류 응답" table:

    | 상황 | HTTP | Body |
    |---|---|---|
    | Validation 실패 | 400 | ``{"errorCode": "VALIDATION_ERROR", ...}`` |
    | Power BI 실패 | 502 | ``{"errorCode": "POWERBI_ERROR", ...}`` |
    | 내부 서버 오류 | 500 | ``{"errorCode": "INTERNAL_ERROR", ...}`` |
    """

    errorCode: str = Field(..., description="기계 판독용 오류 코드")
    errorDescription: str = Field(..., description="사람이 읽을 수 있는 한국어 오류 메시지")
    details: dict | None = Field(
        default=None, description="추가 컨텍스트(선택). 시크릿/스택트레이스는 포함하지 않는다."
    )
