"""서비스 센터(요청) I/O 스키마 (T-46/T-52, R17).

화면 표기는 "서비스 요청/서비스 센터", 내부 엔드포인트/모델은 requests 유지.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

RequestTypeStr = Literal["inquiry", "error", "improvement"]
RequestStatusStr = Literal["pending", "received", "rejected", "done"]


class RequestCreate(BaseModel):
    """요청 생성 (인증된 모든 사용자). 대상 화면은 별도 필드 없이 내용(사유)에 기술."""

    request_type: RequestTypeStr
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=5000)


class RequestUpdate(BaseModel):
    """요청 상태 변경/응답/완료예정일 (System_Operator 전용).

    - status를 rejected로 바꾸면 reject_reason 필수.
    - 모든 필드는 부분 수정(전달된 값만 반영).
    """

    status: RequestStatusStr | None = None
    operator_response: str | None = Field(default=None, max_length=5000)
    reject_reason: str | None = Field(default=None, max_length=5000)
    expected_completion_date: date | None = None

    @model_validator(mode="after")
    def _validate_reject(self) -> "RequestUpdate":
        if self.status == "rejected":
            if not (self.reject_reason and self.reject_reason.strip()):
                raise ValueError("반려(rejected) 시 반려 사유(reject_reason)는 필수입니다.")
        return self


class AttachmentResponse(BaseModel):
    """첨부 파일 메타 응답 (파일 본체는 다운로드 엔드포인트로 제공)."""

    id: int
    request_id: int
    file_name: str
    mime_type: str | None = None
    file_size: int | None = None
    is_image: bool = False
    created_at: datetime


class CommentCreate(BaseModel):
    """댓글(대화) 작성 (요청자 또는 운영자)."""

    body: str = Field(min_length=1, max_length=5000)


class CommentResponse(BaseModel):
    """댓글(대화) 응답."""

    id: int
    request_id: int
    author_user_id: int | None = None
    author_label: str | None = None
    is_operator: bool = False
    body: str
    created_at: datetime


class StatusHistoryResponse(BaseModel):
    """상태 변경 이력 1건 (from → to). from_status가 None이면 요청 생성 시점."""

    id: int
    request_id: int
    from_status: str | None = None
    to_status: str
    changed_by_user_id: int | None = None
    changed_by_label: str | None = None
    created_at: datetime


class RequestResponse(BaseModel):
    """요청 응답 (첨부/댓글 + 요청자 부서/완료예정일 포함)."""

    id: int
    requester_id: int
    requester_name: str | None = None
    requester_department: str | None = None
    request_type: str
    title: str
    body: str | None = None
    status: str
    operator_response: str | None = None
    reject_reason: str | None = None
    expected_completion_date: date | None = None
    created_at: datetime
    updated_at: datetime
    attachments: list[AttachmentResponse] = []
    comments: list[CommentResponse] = []
    status_history: list[StatusHistoryResponse] = []
