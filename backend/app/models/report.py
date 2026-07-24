from datetime import date, datetime
from sqlalchemy import (
    String, Boolean, BigInteger, Integer, ForeignKey, UniqueConstraint, Text,
    Date, DateTime, Index, func,
)
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base

SCHEMA = "bip"

class Workspace(Base):
    __tablename__ = "workspaces"
    __table_args__ = {"schema": SCHEMA}

    workspace_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    workspace_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

class ReportFolder(Base):
    __tablename__ = "report_folders"
    __table_args__ = (UniqueConstraint("parent_id", "name"), {"schema": SCHEMA})

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    parent_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.report_folders.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    folder_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

class Dataset(Base):
    __tablename__ = "datasets"
    __table_args__ = (UniqueConstraint("workspace_id", "dataset_id"), {"schema": SCHEMA})

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(
        String(128), ForeignKey(f"{SCHEMA}.workspaces.workspace_id"), nullable=False
    )
    dataset_id: Mapped[str] = mapped_column(String(128), nullable=False)
    dataset_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (UniqueConstraint("workspace_id", "report_id"), {"schema": SCHEMA})

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(
        String(128), ForeignKey(f"{SCHEMA}.workspaces.workspace_id"), nullable=False
    )
    report_id: Mapped[str] = mapped_column(String(128), nullable=False)
    report_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dataset_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    folder_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.report_folders.id"), nullable=True
    )
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    category: Mapped[str | None] = mapped_column(String(128), nullable=True)
    author_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 공통 기본 뷰 상태(Power BI 북마크 state 문자열). 슬라이서/필터/페이지 선택을 담으며,
    # 관리자가 저장하면 모든 뷰어가 이 상태로 시작한다(.pbix 수정 없이).
    default_view_state: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_by_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )

class ReportPermission(Base):
    __tablename__ = "report_permissions"
    __table_args__ = (
        UniqueConstraint("report_id", "subject_type", "subject_id", "permission"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.reports.id", ondelete="CASCADE"), nullable=False
    )
    subject_type: Mapped[str] = mapped_column(String(16), nullable=False)
    subject_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    permission: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class ReportFavorite(Base):
    """사용자별 레포트 즐겨찾기."""
    __tablename__ = "report_favorites"
    __table_args__ = {"schema": SCHEMA}

    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    report_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.reports.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class UserReportActivity(Base):
    """사용자별 최근 조회 시각과 누적 조회 횟수."""
    __tablename__ = "user_report_activity"
    __table_args__ = (
        Index("ix_user_report_activity_user_last_viewed", "user_id", "last_viewed_at"),
        Index("ix_user_report_activity_report", "report_id"),
        {"schema": SCHEMA},
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), primary_key=True
    )
    report_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.reports.id", ondelete="CASCADE"), primary_key=True
    )
    first_viewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_viewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    view_count: Mapped[int] = mapped_column(BigInteger, default=1, nullable=False)


class ReportViewDailyStat(Base):
    """최근 기간 인기순 계산을 위한 레포트별 일일 조회 집계."""
    __tablename__ = "report_view_daily_stats"
    __table_args__ = (
        Index("ix_report_view_daily_stats_date", "viewed_date"),
        {"schema": SCHEMA},
    )

    report_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.reports.id", ondelete="CASCADE"), primary_key=True
    )
    viewed_date: Mapped[date] = mapped_column(Date, primary_key=True)
    view_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
