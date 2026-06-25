"""SQLAlchemy ORM models.

Importing every model here ensures they are registered on ``Base.metadata``
so Alembic autogenerate (stage 3.2) discovers all tables, constraints, and
indexes. ``Base`` is re-exported for convenience (e.g. ``migrations/env.py``).
"""

from __future__ import annotations

from app.db.base import Base
from app.models.dataset import Dataset
from app.models.refresh_run import RefreshRun
from app.models.refresh_schedule import RefreshSchedule
from app.models.report import Report
from app.models.workspace import Workspace

__all__ = [
    "Base",
    "Dataset",
    "RefreshRun",
    "RefreshSchedule",
    "Report",
    "Workspace",
]
