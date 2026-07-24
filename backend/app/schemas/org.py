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
    role_level: str | None = None  # General_User / System_Operator
    groups: list[GroupRef] = []


class GroupAddRequest(BaseModel):
    """권한 그룹 추가."""
    group_id: int


class RoleLevelRequest(BaseModel):
    """역할 레벨 설정 (General_User / System_Operator)."""
    role_code: str


# ── 팀 권한 그룹 자동 생성/동기화 ─────────────────────────────────────────────

class TeamGroupSyncRequest(BaseModel):
    """조직도 기반 팀 그룹 동기화 요청.

    dept_id 하위(재귀)의 '직속 구성원이 있는 팀'마다 자동 관리 그룹을 만들어
    구성원을 현재 로스터와 완전 동기화한다. apply=False면 미리보기(계획만).
    """
    dept_id: str
    apply: bool = False


class MemberRef(BaseModel):
    """구성원 참조 (미리보기/결과 표시용)."""
    emp_no: str
    name: str


class TeamGroupPlanItem(BaseModel):
    """팀별 동기화 계획/결과."""
    dept_id: str
    dept_name: str
    group_name: str          # 최종 그룹명(충돌 시 상위조직/회사명으로 구분)
    group_id: int | None = None
    created: bool = False    # 신규 생성 여부
    renamed_from: str | None = None  # 이름이 바뀌면 이전 이름
    add: list[MemberRef] = []
    remove: list[MemberRef] = []
    keep: int = 0


class TeamGroupSyncResponse(BaseModel):
    """팀 그룹 동기화 응답 (미리보기 또는 적용 결과)."""
    dept_id: str
    applied: bool
    teams: list[TeamGroupPlanItem] = []
    groups_total: int = 0
    groups_to_create: int = 0
    members_to_add: int = 0
    members_to_remove: int = 0
    to_register: int = 0


OrgNode.model_rebuild()
