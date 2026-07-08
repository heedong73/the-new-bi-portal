"""메일 스케줄 I/O 스키마 (T-27)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

ScheduleFreqStr = Literal["daily", "weekly", "monthly"]


# ---------------------------------------------------------------------------
# 수신자 (MailRecipient)
# ---------------------------------------------------------------------------

RecipientTypeStr = Literal["USER", "GROUP", "DEPARTMENT", "EMAIL"]
# 수신 칸: 받는사람(to)/참조(cc)/숨은참조(bcc)
RecipientFieldStr = Literal["to", "cc", "bcc"]


class RecipientCreate(BaseModel):
    """메일 수신자 추가 요청.

    - EMAIL 타입: email 필수, recipient_id 불가
    - 나머지 타입: recipient_id 필수, email 불가
    - field: 받는사람(to, 기본)/참조(cc)/숨은참조(bcc)
    """

    recipient_type: RecipientTypeStr
    recipient_id: int | None = Field(default=None, gt=0)
    email: EmailStr | None = None
    field: RecipientFieldStr = "to"

    @model_validator(mode="after")
    def _validate_type_fields(self) -> "RecipientCreate":
        if self.recipient_type == "EMAIL":
            if self.email is None:
                raise ValueError("EMAIL 타입은 email이 필수입니다.")
            if self.recipient_id is not None:
                raise ValueError("EMAIL 타입은 recipient_id를 사용하지 않습니다.")
        else:
            if self.recipient_id is None:
                raise ValueError(f"{self.recipient_type} 타입은 recipient_id가 필수입니다.")
            if self.email is not None:
                raise ValueError(f"{self.recipient_type} 타입은 email을 사용하지 않습니다.")
        return self


class RecipientResponse(BaseModel):
    """메일 수신자 응답."""

    id: int
    recipient_type: str
    recipient_id: int | None = None
    email: str | None = None
    field: str = "to"


# ---------------------------------------------------------------------------
# 페이지 (MailSchedulePage)
# ---------------------------------------------------------------------------

class PageCreate(BaseModel):
    """스케줄 페이지 추가 요청."""

    page_name: str = Field(min_length=1, max_length=255)
    caption: str | None = Field(default=None, max_length=255)
    image_width_override: str | None = Field(default=None, max_length=32)
    sort_order: int = Field(default=0, ge=0)


class PageResponse(BaseModel):
    """스케줄 페이지 응답."""

    id: int
    page_name: str
    caption: str | None = None
    image_width_override: str | None = None
    sort_order: int


# ---------------------------------------------------------------------------
# 메일 스케줄 (MailSchedule)
# ---------------------------------------------------------------------------

class MailScheduleCreate(BaseModel):
    """메일 스케줄 생성 요청."""

    report_id: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=255)

    # 메일 내용 커스터마이징
    subject_template: str | None = Field(default=None, max_length=500)
    # 보내는 사람(From) 주소. 비우면 서버 기본값(SMTP_FROM) 사용.
    sender_email: EmailStr | None = None
    body_header: str | None = None
    body_footer: str | None = None

    @field_validator("sender_email", mode="before")
    @classmethod
    def _blank_sender_to_none(cls, v: object) -> object:
        if isinstance(v, str) and v.strip() == "":
            return None
        return v

    # 이미지 옵션
    image_width: str | None = Field(default=None, max_length=32)
    image_resize_px: int | None = Field(default=None, gt=0)

    # 스케줄 / 형식
    cron_expr: str | None = Field(default=None, max_length=128)
    export_format: str = Field(default="PNG", max_length=16)
    enabled: bool = True

    # 사용자 친화 스케줄(주기/시간/기간) — cron_expr 는 서버가 이로부터 생성
    schedule_freq: ScheduleFreqStr | None = None
    schedule_time: str | None = Field(default=None, max_length=8)  # 'HH:MM'
    schedule_days: list[int] = Field(default_factory=list)         # weekly: 0=일~6=토
    schedule_day_of_month: int | None = Field(default=None, ge=1, le=31)
    start_date: date | None = None
    end_date: date | None = None

    # 발송 제외 정책 (주말/공휴일)
    skip_weekends: bool = True
    skip_holidays: bool = True

    # 복합 저장 대상
    recipients: list[RecipientCreate] = Field(default_factory=list)
    pages: list[PageCreate] = Field(default_factory=list)


class MailScheduleUpdate(BaseModel):
    """메일 스케줄 수정 요청 (부분 수정).

    recipients / pages 가 None 이면 기존 값 유지.
    빈 리스트([])를 넘기면 전체 삭제.
    """

    title: str | None = Field(default=None, min_length=1, max_length=255)
    subject_template: str | None = None
    sender_email: EmailStr | None = None
    body_header: str | None = None
    body_footer: str | None = None
    image_width: str | None = Field(default=None, max_length=32)
    image_resize_px: int | None = Field(default=None, gt=0)
    cron_expr: str | None = Field(default=None, max_length=128)
    export_format: str | None = Field(default=None, max_length=16)
    enabled: bool | None = None
    schedule_freq: ScheduleFreqStr | None = None
    schedule_time: str | None = Field(default=None, max_length=8)
    schedule_days: list[int] | None = None
    schedule_day_of_month: int | None = Field(default=None, ge=1, le=31)
    start_date: date | None = None
    end_date: date | None = None
    skip_weekends: bool | None = None
    skip_holidays: bool | None = None

    # 리스트가 None 이면 "변경 없음"으로 처리
    recipients: list[RecipientCreate] | None = None
    pages: list[PageCreate] | None = None

    @field_validator("sender_email", mode="before")
    @classmethod
    def _blank_sender_to_none(cls, v: object) -> object:
        if isinstance(v, str) and v.strip() == "":
            return None
        return v


class MailScheduleResponse(BaseModel):
    """메일 스케줄 응답 (복합 포함)."""

    id: int
    report_id: int
    title: str
    subject_template: str | None = None
    sender_email: str | None = None
    body_header: str | None = None
    body_footer: str | None = None
    image_width: str | None = None
    image_resize_px: int | None = None
    cron_expr: str | None = None
    export_format: str
    enabled: bool
    schedule_freq: str | None = None
    schedule_time: str | None = None
    schedule_days: list[int] = []
    schedule_day_of_month: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    skip_weekends: bool = True
    skip_holidays: bool = True
    created_at: datetime

    recipients: list[RecipientResponse] = []
    pages: list[PageResponse] = []
