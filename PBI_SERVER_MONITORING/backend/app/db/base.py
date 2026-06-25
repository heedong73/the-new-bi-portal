"""SQLAlchemy 2.x declarative base and shared mixins.

Design reference: "Data Models" (테이블 스펙, ERD).

All ORM models inherit from :class:`Base` so that a single
``Base.metadata`` collects every table for Alembic autogenerate (stage 3.2).
:class:`TimestampMixin` provides the ``created_at`` / ``updated_at``
TIMESTAMPTZ columns that every table in the design shares
(``NOT NULL DEFAULT now()`` with ``updated_at`` refreshed ``onupdate``).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Declarative base shared by every ORM model.

    A single ``Base.metadata`` registry lets Alembic discover all tables for
    autogenerate, provided each model module is imported (see
    ``app.models.__init__``).
    """


class TimestampMixin:
    """Adds ``created_at`` / ``updated_at`` TIMESTAMPTZ columns.

    Both default to ``now()`` at the database level; ``updated_at`` is also
    refreshed on every UPDATE via ``onupdate=func.now()``. Using
    ``server_default`` keeps the default authoritative in the schema so that
    inserts issued outside the ORM (e.g. raw SQL upserts) still populate them.
    """

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
