"""공휴일 관리 I/O 스키마."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

HolidayTypeStr = Literal["national", "substitute", "company"]


class HolidayCreate(BaseModel):
    """공휴일 추가 요청 (주로 사내 공휴일)."""
    holiday_date: date
    name: str = Field(min_length=1, max_length=255)
    holiday_type: HolidayTypeStr = "company"
    is_recurring: bool = False


class HolidayResponse(BaseModel):
    """공휴일 응답."""
    id: int
    holiday_date: date
    name: str
    holiday_type: str
    is_recurring: bool
    created_at: datetime


class HolidaySeedRequest(BaseModel):
    """국가 공휴일 시드 요청."""
    year: int = Field(ge=2000, le=2100)


class HolidaySeedResponse(BaseModel):
    year: int
    added: int
