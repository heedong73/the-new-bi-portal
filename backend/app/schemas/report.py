"""레포트 카탈로그 I/O 스키마."""
from __future__ import annotations

from pydantic import BaseModel, Field

class ReportCreate(BaseModel):
    """ID 수동 등록 요청."""
    workspace_id: str = Field(min_length=1, max_length=128)
    report_id: str = Field(min_length=1, max_length=128)
    dataset_id: str | None = Field(default=None, max_length=128)
    report_name: str | None = Field(default=None, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=500)
    folder_id: int | None = None

class ReportUpdate(BaseModel):
    """레포트 메타데이터 수정 요청 (부분)."""
    display_name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, max_length=128)

class VisibilityUpdate(BaseModel):
    """공개/비공개 전환 요청."""
    is_published: bool

class FolderMoveRequest(BaseModel):
    """레포트 폴더 이동 요청."""
    folder_id: int | None = None

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
    is_published: bool
