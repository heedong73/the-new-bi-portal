"""Remove the unused global executive statistics-reader role.

Revision ID: c6d9a2e4f781
Revises: b1e9f4c6d802
Create Date: 2026-07-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "c6d9a2e4f781"
down_revision = "b1e9f4c6d802"
branch_labels = None
depends_on = None

SCHEMA = "bip"
ROLE_CODE = "Executive_Stats_Reader"
ROLE_NAME = "담당임원 통계 열람자"


def upgrade() -> None:
    """Remove the retired role and dependent polymorphic permission rows."""
    # Prevent a concurrent administrator request from assigning the retired role
    # or granting it report permissions between dependency cleanup and role removal.
    op.execute(sa.text(f"""
        LOCK TABLE
            {SCHEMA}.roles,
            {SCHEMA}.user_roles,
            {SCHEMA}.report_permissions
        IN SHARE ROW EXCLUSIVE MODE
    """))
    # user_roles and report_permissions use independent/polymorphic references,
    # so clean both before deleting the role. Each statement is idempotent for
    # installations where the unused role has no assignments or grants.
    op.execute(sa.text(f"""
        DELETE FROM {SCHEMA}.report_permissions
        WHERE subject_type = 'role'
          AND subject_id IN (
              SELECT id FROM {SCHEMA}.roles WHERE code = '{ROLE_CODE}'
          )
    """))
    op.execute(sa.text(f"""
        DELETE FROM {SCHEMA}.user_roles
        WHERE role_id IN (
            SELECT id FROM {SCHEMA}.roles WHERE code = '{ROLE_CODE}'
        )
    """))
    op.execute(sa.text(f"""
        DELETE FROM {SCHEMA}.roles WHERE code = '{ROLE_CODE}'
    """))


def downgrade() -> None:
    """Restore the role definition without intentionally removed assignments/grants."""
    op.execute(sa.text(f"""
        INSERT INTO {SCHEMA}.roles (code, name)
        VALUES ('{ROLE_CODE}', '{ROLE_NAME}')
        ON CONFLICT (code) DO NOTHING
    """))
