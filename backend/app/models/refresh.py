from datetime import datetime
from sqlalchemy import String, Boolean, BigInteger, Integer, Text, UniqueConstraint, DateTime, func
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base

SCHEMA = "bip"


class RefreshRun(Base):
    __tablename__ = "refresh_runs"
    __table_args__ = (
        UniqueConstraint("workspace_id", "dataset_id", "request_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    dataset_id: Mapped[str] = mapped_column(String(128), nullable=False)
    request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    start_time_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    start_time_local: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time_local: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

class RefreshSchedule(Base):
    __tablename__ = "refresh_schedules"
    __table_args__ = (
        UniqueConstraint("workspace_id", "dataset_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String(128), nullable=False)
    dataset_id: Mapped[str] = mapped_column(String(128), nullable=False)
    days: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)
    times: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
