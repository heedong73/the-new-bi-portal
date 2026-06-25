"""레포트 폴더 I/O 스키마."""
from __future__ import annotations

from pydantic import BaseModel, Field

class FolderCreate(BaseModel):
    """폴더 생성 요청."""
    name: str = Field(min_length=1, max_length=255)
    parent_id: int | None = None
    folder_type: str | None = Field(default=None, max_length=64)
    sort_order: int = 0

class FolderUpdate(BaseModel):
    """폴더 수정 요청 (부분)."""
    name: str | None = Field(default=None, min_length=1, max_length=255)
    parent_id: int | None = None
    folder_type: str | None = Field(default=None, max_length=64)
    sort_order: int | None = None

class FolderResponse(BaseModel):
    """폴더 응답."""
    id: int
    parent_id: int | None = None
    name: str
    folder_type: str | None = None
    sort_order: int

class FolderTreeNode(BaseModel):
    """폴더 트리 노드 (자식 폴더 + 권한 필터된 레포트 포함)."""
    id: int
    name: str
    folder_type: str | None = None
    sort_order: int
    children: list["FolderTreeNode"] = Field(default_factory=list)
    report_ids: list[int] = Field(default_factory=list)
