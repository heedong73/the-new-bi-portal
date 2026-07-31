"""Materialize group company scopes as explicit report VIEW grants.

Each existing group/root-folder scope is expanded to its current descendant reports
before the dynamic scope table is removed. Future reports therefore require a
separate explicit grant.

Revision ID: b1e9f4c6d802
Revises: a4e9c7d2f613
Create Date: 2026-07-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "b1e9f4c6d802"
down_revision = "a4e9c7d2f613"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    """Preserve current scope-derived access as explicit group VIEW grants."""
    # Freeze the source hierarchy while it is expanded. Otherwise a scope, folder,
    # or report written between the read and the table drop could lose its former
    # dynamic VIEW grant at cutover.
    op.execute(sa.text(f"""
        LOCK TABLE
            {SCHEMA}.group_company_scopes,
            {SCHEMA}.report_folders,
            {SCHEMA}.reports
        IN SHARE ROW EXCLUSIVE MODE
    """))
    op.execute(sa.text(f"""
        WITH RECURSIVE scoped_folders(group_id, folder_id) AS (
            SELECT group_id, root_folder_id
            FROM {SCHEMA}.group_company_scopes
            UNION
            SELECT scoped_folders.group_id, folders.id
            FROM {SCHEMA}.report_folders AS folders
            JOIN scoped_folders
              ON folders.parent_id = scoped_folders.folder_id
        )
        INSERT INTO {SCHEMA}.report_permissions (
            report_id, subject_type, subject_id, permission
        )
        SELECT DISTINCT reports.id, 'group', scoped_folders.group_id, 'VIEW'
        FROM {SCHEMA}.reports AS reports
        JOIN scoped_folders ON reports.folder_id = scoped_folders.folder_id
        ON CONFLICT (report_id, subject_type, subject_id, permission) DO NOTHING
    """))
    op.drop_table("group_company_scopes", schema=SCHEMA)


def downgrade() -> None:
    """Restore the legacy table empty; original scope roots are not recoverable.

    Materialized report grants deliberately remain because they cannot be safely
    distinguished from grants created independently after this migration.
    """
    op.create_table(
        "group_company_scopes",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("group_id", sa.BigInteger(), nullable=False),
        sa.Column("root_folder_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], [f"{SCHEMA}.user_groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["root_folder_id"], [f"{SCHEMA}.report_folders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("group_id", "root_folder_id"),
        schema=SCHEMA,
    )
