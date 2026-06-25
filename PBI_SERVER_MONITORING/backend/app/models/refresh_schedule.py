"""``refresh_schedules`` table ORM model.

Design reference: "테이블 스펙 › refresh_schedules".
"""

from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, ForeignKey, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class RefreshSchedule(Base, TimestampMixin):
    """A dataset's scheduled refresh configuration.

    ``days`` (e.g. ``["Monday", ...]``) and ``times`` (e.g. ``["07:00"]``) are
    PostgreSQL text arrays defaulting to empty. ``enabled`` defaults to true.
    Unique per ``(workspace_id, dataset_id)``.
    """

    __tablename__ = "refresh_schedules"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "dataset_id", name="uq_schedules_ws_dataset"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("workspaces.workspace_id"),
        nullable=False,
    )
    dataset_id: Mapped[str] = mapped_column(String(64), nullable=False)
    days: Mapped[list[str]] = mapped_column(
        ARRAY(String(16)),
        nullable=False,
        server_default=text("'{}'::varchar[]"),
    )
    times: Mapped[list[str]] = mapped_column(
        ARRAY(String(8)),
        nullable=False,
        server_default=text("'{}'::varchar[]"),
    )
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
