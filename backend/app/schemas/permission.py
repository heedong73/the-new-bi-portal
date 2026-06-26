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

class PermissionResponse(BaseModel):
    """레포트 권한 항목 응답."""
    id: int
    report_id: int
    subject_type: str
    subject_id: int
    permission: str


class MenuCatalogItem(BaseModel):
    """메뉴 카탈로그 항목."""
    key: str
    label: str

class RoleMenusItem(BaseModel):
    """역할별 메뉴 권한."""
    id: int
    code: str
    name: str
    menus: list[str] = Field(default_factory=list)

class RoleMenusResponse(BaseModel):
    """역할-메뉴 매트릭스 응답."""
    catalog: list[MenuCatalogItem]
    roles: list[RoleMenusItem]

class RoleMenusUpdate(BaseModel):
    """역할 메뉴 권한 일괄 설정."""
    menus: list[str]
