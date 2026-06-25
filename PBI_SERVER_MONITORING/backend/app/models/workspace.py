"""``workspaces`` table ORM model.

Design reference: "테이블 스펙 › workspaces".
"""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Workspace(Base, TimestampMixin):
    """A Power BI workspace (group).

    The natural key ``workspace_id`` (Power BI ``groupId``) is the primary key
    since the application always identifies workspaces by that value.
    """

    __tablename__ = "workspaces"

    workspace_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_name: Mapped[str] = mapped_column(String(255), nullable=False)
