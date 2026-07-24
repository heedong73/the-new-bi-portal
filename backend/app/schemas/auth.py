"""인증 도메인 I/O 스키마 (Pydantic v2)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

class LoginRequest(BaseModel):
    """사번/비밀번호 로그인 요청."""
    emp_no: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)

class LocalLoginRequest(BaseModel):
    """로컬 관리자 로그인 요청."""
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)

class UserSummary(BaseModel):
    """현재 사용자 요약 (응답용). 비밀번호/해시 미포함."""
    id: int
    emp_no: str
    name: str
    email: str | None = None
    department_id: int | None = None
    department_name: str | None = None
    roles: list[str] = Field(default_factory=list)
    allowed_menus: list[str] = Field(default_factory=list)
    # 직전 로그인 성공 시각(UTC). 이번 로그인으로 갱신되기 "전" 값을 보여준다
    # (방금 로그인한 시각이 아니라 "마지막으로 접속했던 때"가 의미 있으므로).
    last_login_at: datetime | None = None

class LoginResponse(BaseModel):
    """로그인 성공 응답."""
    user: UserSummary
