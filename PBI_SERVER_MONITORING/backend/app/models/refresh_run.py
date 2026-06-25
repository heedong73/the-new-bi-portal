"""``refresh_runs`` table ORM model.

Design reference: "테이블 스펙 › refresh_runs".

This is the central fact table. Each row is a single dataset refresh execution
uniquely identified by ``(workspace_id, dataset_id, request_id)`` (Requirement
5.4). ``status`` is the normalized internal enum (``status_mapper``), guarded
by a CHECK constraint. ``raw_json`` preserves the original Power BI payload
(Requirement 4.10). Dual time columns store both UTC and APP_TIMEZONE-local
values (Requirement 7.1, 7.2).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

# Allowed normalized status values (Power BI status → internal enum).
VALID_STATUSES = ("success", "failed", "in_progress", "unknown")


class RefreshRun(Base, TimestampMixin):
    """A single dataset refresh execution.

    ``report_id`` / ``report_name`` / ``dataset_name`` are denormalized for
    query convenience and may be ``None`` (Power BI does not return reportId on
    refresh history). ``end_time_*`` and ``duration_seconds`` are ``None`` while
    a refresh is in progress; the in-progress duration is computed dynamically
    at query time (Requirement 7.4).
    """

    __tablename__ = "refresh_runs"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "dataset_id",
            "request_id",
            name="uq_runs_ws_dataset_request",
        ),
        CheckConstraint(
            "status IN ('success', 'failed', 'in_progress', 'unknown')",
            name="ck_runs_status",
        ),
        Index("idx_runs_ws_start", "workspace_id", text("start_time_utc DESC")),
        Index("idx_runs_status", "status"),
        Index(
            "idx_runs_dataset",
            "workspace_id",
            "dataset_id",
            text("start_time_utc DESC"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String(64), nullable=False)
    report_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    report_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    dataset_id: Mapped[str] = mapped_column(String(64), nullable=False)
    dataset_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    refresh_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    start_time_utc: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False
    )
    end_time_utc: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    start_time_local: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False
    )
    end_time_local: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
