"""그룹 관리 I/O 스키마."""
from __future__ import annotations

from pydantic import BaseModel, Field

class GroupCreate(BaseModel):
    """그룹 생성 요청."""
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=500)

class GroupUpdate(BaseModel):
    """그룹 수정 요청 (부분 수정)."""
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=500)

class GroupResponse(BaseModel):
    """그룹 응답."""
    id: int
    name: str
    description: str | None = None

class MemberRequest(BaseModel):
    """그룹원 추가/제거 요청."""
    user_id: int

class GroupMemberItem(BaseModel):
    """그룹원 목록 항목."""
    id: int
    emp_no: str
    name: str
    email: str | None = None
    department_id: int | None = None
