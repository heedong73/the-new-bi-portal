from datetime import datetime
from sqlalchemy import String, Boolean, BigInteger, Integer, ForeignKey, UniqueConstraint, func
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
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
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
