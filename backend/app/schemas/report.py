"""레포트 카탈로그 I/O 스키마."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

class ReportUpdate(BaseModel):
    """레포트 메타데이터 수정 요청 (부분)."""
    display_name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, max_length=128)
    author_label: str | None = Field(default=None, max_length=255)
    sort_order: int | None = None

class VisibilityUpdate(BaseModel):
    """공개/비공개 전환 요청."""
    is_published: bool

class FolderMoveRequest(BaseModel):
    """레포트 폴더 이동 요청."""
    folder_id: int | None = None

class DefaultViewUpdate(BaseModel):
    """공통 기본 뷰 상태 저장/초기화 요청.

    state = Power BI 북마크 state 문자열. None/빈 값이면 기본 뷰 해제.
    """
    state: str | None = None

class ExportRequest(BaseModel):
    """독립 Export 요청 (T-25). 포맷: PDF | PNG | PPTX"""
    export_format: str = Field(default="PDF", pattern="^(PDF|PNG|PPTX)$")

class ReportResponse(BaseModel):
    """레포트 응답 (목록/상세)."""
    id: int
    workspace_id: str
    report_id: str
    dataset_id: str | None = None
    report_name: str | None = None
    display_name: str | None = None
    description: str | None = None
    category: str | None = None
    folder_id: int | None = None
    sort_order: int = 0
    is_published: bool
    author_label: str | None = None
    updated_at: datetime | None = None
    is_favorite: bool = False
    created_by_user_id: int | None = None
    created_by_label: str | None = None
    created_at: datetime | None = None
    can_manage: bool = False  # MANAGE_REPORT 권한(레포트 교체 가능) 여부
