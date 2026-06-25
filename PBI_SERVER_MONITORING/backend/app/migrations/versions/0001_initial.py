"""initial schema: workspaces, reports, datasets, refresh_runs, refresh_schedules

Revision ID: 0001
Revises:
Create Date: 2025-01-01 00:00:00.000000

Hand-authored (Alembic is not installed in this environment, so
``alembic revision --autogenerate`` could not be run). Every table, constraint,
and index below mirrors the SQLAlchemy ORM models 1:1 (see ``app/models/*`` and
design.md "테이블 스펙").

Tables are created in FK dependency order (workspaces first, since reports /
datasets / refresh_schedules reference ``workspaces.workspace_id``).
``refresh_runs`` has no FK by design (workspace_id / dataset_id are plain
columns).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---------------------------------------------------------------
    # workspaces (natural PK: workspace_id)
    # ---------------------------------------------------------------
    op.create_table(
        "workspaces",
        sa.Column("workspace_id", sa.String(length=64), nullable=False),
        sa.Column("workspace_name", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("workspace_id"),
    )

    # ---------------------------------------------------------------
    # reports (FK -> workspaces; nullable dataset_id for paginated reports)
    # ---------------------------------------------------------------
    op.create_table(
        "reports",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.String(length=64), nullable=False),
        sa.Column("report_id", sa.String(length=64), nullable=False),
        sa.Column("report_name", sa.String(length=500), nullable=False),
        sa.Column("dataset_id", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.workspace_id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "report_id", name="uq_reports_ws_report"
        ),
    )
    op.create_index(
        "idx_reports_dataset",
        "reports",
        ["workspace_id", "dataset_id"],
        unique=False,
    )

    # ---------------------------------------------------------------
    # datasets (FK -> workspaces)
    # ---------------------------------------------------------------
    op.create_table(
        "datasets",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.String(length=64), nullable=False),
        sa.Column("dataset_id", sa.String(length=64), nullable=False),
        sa.Column("dataset_name", sa.String(length=500), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.workspace_id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "dataset_id", name="uq_datasets_ws_dataset"
        ),
    )

    # ---------------------------------------------------------------
    # refresh_runs (central fact table; no FK by design)
    #   - UNIQUE (workspace_id, dataset_id, request_id)
    #   - CHECK status in normalized enum
    #   - raw_json JSONB, dual time columns
    #   - DESC indexes for time-range / dataset queries
    # ---------------------------------------------------------------
    op.create_table(
        "refresh_runs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.String(length=64), nullable=False),
        sa.Column("report_id", sa.String(length=64), nullable=True),
        sa.Column("report_name", sa.String(length=500), nullable=True),
        sa.Column("dataset_id", sa.String(length=64), nullable=False),
        sa.Column("dataset_name", sa.String(length=500), nullable=True),
        sa.Column("refresh_type", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("start_time_utc", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("end_time_utc", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("start_time_local", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("end_time_local", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("request_id", sa.String(length=128), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("raw_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('success', 'failed', 'in_progress', 'unknown')",
            name="ck_runs_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id",
            "dataset_id",
            "request_id",
            name="uq_runs_ws_dataset_request",
        ),
    )
    op.create_index(
        "idx_runs_ws_start",
        "refresh_runs",
        ["workspace_id", sa.text("start_time_utc DESC")],
        unique=False,
    )
    op.create_index(
        "idx_runs_status",
        "refresh_runs",
        ["status"],
        unique=False,
    )
    op.create_index(
        "idx_runs_dataset",
        "refresh_runs",
        ["workspace_id", "dataset_id", sa.text("start_time_utc DESC")],
        unique=False,
    )

    # ---------------------------------------------------------------
    # refresh_schedules (FK -> workspaces; text arrays for days/times)
    # ---------------------------------------------------------------
    op.create_table(
        "refresh_schedules",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.String(length=64), nullable=False),
        sa.Column("dataset_id", sa.String(length=64), nullable=False),
        sa.Column(
            "days",
            postgresql.ARRAY(sa.String(length=16)),
            server_default=sa.text("'{}'::varchar[]"),
            nullable=False,
        ),
        sa.Column(
            "times",
            postgresql.ARRAY(sa.String(length=8)),
            server_default=sa.text("'{}'::varchar[]"),
            nullable=False,
        ),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column(
            "enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.workspace_id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "dataset_id", name="uq_schedules_ws_dataset"
        ),
    )


def downgrade() -> None:
    # Drop in reverse dependency order.
    op.drop_table("refresh_schedules")
    op.drop_index("idx_runs_dataset", table_name="refresh_runs")
    op.drop_index("idx_runs_status", table_name="refresh_runs")
    op.drop_index("idx_runs_ws_start", table_name="refresh_runs")
    op.drop_table("refresh_runs")
    op.drop_table("datasets")
    op.drop_index("idx_reports_dataset", table_name="reports")
    op.drop_table("reports")
    op.drop_table("workspaces")
