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
    # True면 관리자가 만든 로컬 계정(HR 인사 정보 없음). 조직도와 무관하며 password_hash 보유.
    is_local: bool = False

class UserStatusUpdate(BaseModel):
    """사용자 활성/비활성 변경 요청."""
    is_active: bool

class LocalUserCreate(BaseModel):
    """로컬 사용자 생성 요청 — 관리자가 테스트/외부 인력용으로 직접 만드는 계정.

    login_id는 users.external_id에 저장하는 자유 문자열이다. HR 사번과 겹치면 안 되며
    external_id UNIQUE 제약이 이를 보장한다(중복이면 ConflictError).
    """
    login_id: str = Field(min_length=3, max_length=64, description="로그인 아이디(자유 문자열, 중복 불가)")
    name: str = Field(min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    password: str = Field(min_length=8, max_length=256)
    role_code: str = Field(default="General_User", description="초기 부여 역할 코드")

class LocalUserUpdate(BaseModel):
    """로컬 사용자 이름·이메일 수정 요청. 비밀번호 재설정은 별도 엔드포인트."""
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=255)

class LocalUserPasswordReset(BaseModel):
    """로컬 사용자 비밀번호 재설정 요청(운영자 전용)."""
    password: str = Field(min_length=8, max_length=256)
