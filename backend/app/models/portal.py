from datetime import datetime

from sqlalchemy import String, BigInteger, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base

SCHEMA = "bip"


class UserGroup(Base):
    __tablename__ = "user_groups"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 조직도 자동 생성 팀 그룹의 출처 부서 ID. 값이 있으면 "자동 관리 그룹"으로,
    # 완전 동기화(추가+제거) 대상이 된다. 수동 그룹은 None(동기화가 건드리지 않음).
    source_dept_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)


class UserGroupMember(Base):
    __tablename__ = "user_group_members"
    __table_args__ = {"schema": SCHEMA}

    group_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.user_groups.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id"), primary_key=True
    )


class MenuPermission(Base):
    """메뉴(페이지) 접근 권한 — 주체(사용자/그룹) 기반 부여.

    역할 고정 매핑(ROLE_MENUS)에 더해, 관리자가 그룹 또는 개별 사용자에게
    특정 메뉴 접근을 추가로 부여할 수 있다. System_Operator는 항상 전체 메뉴
    접근을 별도로 보유하므로 이 테이블의 대상이 아니다(R7/권한 관리 개편).
    """
    __tablename__ = "menu_permissions"
    __table_args__ = (
        UniqueConstraint("subject_type", "subject_id", "menu_key"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    subject_type: Mapped[str] = mapped_column(String(16), nullable=False)  # user | group
    subject_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    menu_key: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
