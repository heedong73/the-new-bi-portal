"""사용자 관리 I/O 스키마."""
from __future__ import annotations

from pydantic import BaseModel, Field

class UserGroupBrief(BaseModel):
    """사용자에 부여된 권한 그룹 요약."""
    id: int
    name: str

class UserListItem(BaseModel):
    """사용자 목록 항목."""
    id: int
    emp_no: str
    name: str
    email: str | None = None
    department_id: int | None = None
    department_ext_id: str | None = None  # departments.external_id = 조직도(HR) dept_id
    department_name: str | None = None
    roles: list[str] = Field(default_factory=list)
    groups: list[UserGroupBrief] = Field(default_factory=list)
    is_active: bool

class UserStatusUpdate(BaseModel):
    """사용자 활성/비활성 변경 요청."""
    is_active: bool
