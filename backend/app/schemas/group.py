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


class GroupTreeNode(BaseModel):
    """그룹 트리 노드(조직 계층). group_id가 있으면 그 부서의 팀 그룹, 없으면 구조용 폴더."""
    dept_id: str
    dept_name: str
    group_id: int | None = None
    group_name: str | None = None
    member_count: int | None = None
    has_members: bool = False  # 직속 구성원(재직) 보유 = 그룹화 가능한 '팀'
    children: list["GroupTreeNode"] = []


class GroupTreeResponse(BaseModel):
    """그룹 트리 응답. tree=자동 팀 그룹(조직 계층), ungrouped=수동/미배치 그룹."""
    tree: list[GroupTreeNode] = []
    ungrouped: list[GroupResponse] = []


GroupTreeNode.model_rebuild()
