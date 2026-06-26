"""조직도/인사 사용자 조회 스키마 (인사 뷰 기반, 읽기 전용)."""
from __future__ import annotations

from pydantic import BaseModel


class CompanyItem(BaseModel):
    """회사(조직 최상위) 항목."""
    cmp_id: str
    dept_id: str
    dept_name: str


class OrgNode(BaseModel):
    """조직도 트리 노드 (재귀)."""
    dept_id: str
    dept_name: str
    cmp_id: str | None = None
    depth: int
    children: list["OrgNode"] = []


class GroupRef(BaseModel):
    """권한 그룹 참조."""
    id: int
    name: str


class OrgMember(BaseModel):
    """부서 구성원 (인사 + BIP 등록 상태). 권한 그룹은 다중."""
    emp_no: str
    name: str
    email: str | None = None
    dept_id: str | None = None
    dept_name: str | None = None
    ofc_name: str | None = None  # 직급명
    # BIP 등록 상태
    registered: bool = False
    user_id: int | None = None
    is_active: bool | None = None
    role_level: str | None = None  # General_User / Super_User / System_Operator
    groups: list[GroupRef] = []


class GroupAddRequest(BaseModel):
    """권한 그룹 추가."""
    group_id: int


class RoleLevelRequest(BaseModel):
    """역할 레벨 설정 (General_User / Super_User / System_Operator)."""
    role_code: str


OrgNode.model_rebuild()
