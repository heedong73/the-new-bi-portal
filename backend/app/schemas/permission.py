"""역할/레포트 권한 I/O 스키마."""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.core.constants import PermissionAction, SubjectType

class RoleResponse(BaseModel):
    """역할 응답."""
    id: int
    code: str
    name: str

class RoleAssignRequest(BaseModel):
    """역할 부여/회수 요청."""
    role_code: str

class PermissionGrantRequest(BaseModel):
    """레포트 권한 부여 요청."""
    subject_type: SubjectType
    subject_id: int
    permission: PermissionAction

class PermissionBulkGrantRequest(BaseModel):
    """레포트 권한 다중 부여 요청 (한 주체에 여러 권한 동시 부여, 멱등)."""
    subject_type: SubjectType
    subject_id: int
    permissions: list[PermissionAction] = Field(default_factory=list, min_length=1)

class PermissionResponse(BaseModel):
    """레포트 권한 항목 응답."""
    id: int
    report_id: int
    subject_type: str
    subject_id: int
    permission: str
