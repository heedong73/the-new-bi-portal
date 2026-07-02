from sqlalchemy import String, BigInteger, ForeignKey, UniqueConstraint
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
