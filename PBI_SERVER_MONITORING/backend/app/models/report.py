"""``reports`` table ORM model.

Design reference: "테이블 스펙 › reports".
"""

from __future__ import annotations

from sqlalchemy import BigInteger, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Report(Base, TimestampMixin):
    """A Power BI report.

    ``dataset_id`` is nullable: paginated reports have no semantic model
    (Requirement 6.3). The ``(workspace_id, dataset_id)`` index accelerates the
    Report ↔ Refresh History join performed at query time.
    """

    __tablename__ = "reports"
    __table_args__ = (
        UniqueConstraint("workspace_id", "report_id", name="uq_reports_ws_report"),
        Index("idx_reports_dataset", "workspace_id", "dataset_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("workspaces.workspace_id"),
        nullable=False,
    )
    report_id: Mapped[str] = mapped_column(String(64), nullable=False)
    report_name: Mapped[str] = mapped_column(String(500), nullable=False)
    dataset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
