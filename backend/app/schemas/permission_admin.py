"""권한 관리 개편 I/O 스키마 — 그룹/사용자 메뉴 권한, 그룹 허용 계열사 스코프."""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.core.constants import PermissionAction

# menu_permissions.subject_type 허용 값(역할/부서는 대상이 아님 — 확인사항 2).
MENU_SUBJECT_TYPES = ("user", "group")


class MenuPermissionSetRequest(BaseModel):
    """특정 주체(사용자 또는 그룹)의 메뉴 접근 권한을 전체 교체(멱등)."""
    menu_keys: list[str] = Field(default_factory=list)


class MenuPermissionItem(BaseModel):
    """메뉴 권한 항목 응답."""
    id: int
    subject_type: str
    subject_id: int
    menu_key: str


class MenuSubjectItem(BaseModel):
    """메뉴별 접근 주체 조회 응답 항목 (관리 화면의 '메뉴 관리' 탭용)."""
    subject_type: str  # user | group
    subject_id: int
    label: str  # 사용자명(사번) 또는 그룹명
    source: str  # "group" | "direct" — group이면 그룹 권한으로 얻은 개별 사용자


class GroupCompanyScopeSetRequest(BaseModel):
    """그룹의 허용 계열사(최상위 폴더) 스코프를 전체 교체(멱등)."""
    root_folder_ids: list[int] = Field(default_factory=list)


class GroupCompanyScopeItem(BaseModel):
    """그룹 허용 계열사 응답 항목."""
    root_folder_id: int
    root_folder_name: str


class GroupReportBulkGrantRequest(BaseModel):
    """그룹(또는 사용자)에게 여러 레포트에 대해 동일 권한 세트를 한 번에 부여(멱등)."""
    subject_type: str = "group"  # user | group
    subject_id: int
    report_ids: list[int] = Field(default_factory=list, min_length=1)
    permissions: list[PermissionAction] = Field(default_factory=list, min_length=1)


# ===== 개인별(사용자) 유효 권한 조회 =====

class UserGroupBrief(BaseModel):
    """사용자가 소속된 그룹 요약."""
    id: int
    name: str


class InheritedMenuItem(BaseModel):
    """그룹/역할에서 상속된 메뉴 접근(읽기 전용, 출처 표시)."""
    menu_key: str
    label: str
    source_type: str  # role | group
    source_label: str  # 역할 코드 또는 그룹명


class DirectReportPermission(BaseModel):
    """사용자에게 직접 부여된 레포트 권한(회수 가능 — permission_id 사용)."""
    permission_id: int
    report_id: int
    report_name: str
    folder_name: str | None = None
    permission: str


class InheritedReportPermission(BaseModel):
    """그룹/역할/부서/계열사 스코프로 상속된 레포트 권한(읽기 전용, 출처 표시)."""
    report_id: int
    report_name: str
    folder_name: str | None = None
    permission: str
    source_type: str  # group | role | dept | scope
    source_label: str  # 그룹명 / 역할 코드 / 부서명 / 계열사명


class UserEffectivePermissions(BaseModel):
    """개인별 권한 화면 — 한 사용자의 직접·상속 권한을 출처와 함께 총람."""
    user_id: int
    emp_no: str
    name: str
    department_name: str | None = None
    is_operator: bool
    roles: list[str] = Field(default_factory=list)
    groups: list[UserGroupBrief] = Field(default_factory=list)
    direct_menu_keys: list[str] = Field(default_factory=list)
    inherited_menus: list[InheritedMenuItem] = Field(default_factory=list)
    direct_reports: list[DirectReportPermission] = Field(default_factory=list)
    inherited_reports: list[InheritedReportPermission] = Field(default_factory=list)
