"""``datasets`` table ORM model.

Design reference: "테이블 스펙 › datasets".
"""

from __future__ import annotations

from sqlalchemy import BigInteger, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Dataset(Base, TimestampMixin):
    """A Power BI dataset (semantic model)."""

    __tablename__ = "datasets"
    __table_args__ = (
        UniqueConstraint("workspace_id", "dataset_id", name="uq_datasets_ws_dataset"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("workspaces.workspace_id"),
        nullable=False,
    )
    dataset_id: Mapped[str] = mapped_column(String(64), nullable=False)
    dataset_name: Mapped[str] = mapped_column(String(500), nullable=False)
