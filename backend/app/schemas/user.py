"""사용자 관리 I/O 스키마."""
from __future__ import annotations

from pydantic import BaseModel, Field

class UserListItem(BaseModel):
    """사용자 목록 항목."""
    id: int
    emp_no: str
    name: str
    email: str | None = None
    department_id: int | None = None
    roles: list[str] = Field(default_factory=list)
    is_active: bool

class UserStatusUpdate(BaseModel):
    """사용자 활성/비활성 변경 요청."""
    is_active: bool
