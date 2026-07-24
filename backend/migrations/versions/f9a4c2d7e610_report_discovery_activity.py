"""report discovery activity, daily popularity, and published timestamp

Revision ID: f9a4c2d7e610
Revises: d8a3f7c1e920
Create Date: 2026-07-14
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "f9a4c2d7e610"
down_revision = "d8a3f7c1e920"
branch_labels = None
depends_on = None

SCHEMA = "bip"


def upgrade() -> None:
    op.add_column(
        "reports",
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.execute(
        "UPDATE bip.reports SET published_at = created_at "
        "WHERE is_published = TRUE AND published_at IS NULL"
    )

    op.create_table(
        "user_report_activity",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("report_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "first_viewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_viewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("view_count", sa.BigInteger(), server_default="1", nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["bip.users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["report_id"], ["bip.reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "report_id"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_user_report_activity_user_last_viewed",
        "user_report_activity",
        ["user_id", "last_viewed_at"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_user_report_activity_report",
        "user_report_activity",
        ["report_id"],
        schema=SCHEMA,
    )

    op.create_table(
        "report_view_daily_stats",
        sa.Column("report_id", sa.BigInteger(), nullable=False),
        sa.Column("viewed_date", sa.Date(), nullable=False),
        sa.Column("view_count", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["report_id"], ["bip.reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("report_id", "viewed_date"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_report_view_daily_stats_date",
        "report_view_daily_stats",
        ["viewed_date"],
        schema=SCHEMA,
    )

    # 기존 report_view 감사 로그를 탐색용 요약 데이터로 이관한다.
    # resource_id는 CASE 안에서만 bigint로 변환하고, actor id/label이 실제 사용자와
    # 모두 일치하는 로그만 반영해 독립 시퀀스를 쓰는 로컬 관리자 id 충돌을 배제한다.
    op.execute(
        """
        WITH report_views AS (
            SELECT
                a.actor_user_id,
                a.actor_label,
                CASE
                    WHEN a.resource_id ~ '^[0-9]+$' THEN a.resource_id::bigint
                END AS report_id,
                a.occurred_at_utc
            FROM bip.audit_logs a
            WHERE a.action = 'report_view'
              AND a.result = 'success'
              AND a.actor_user_id IS NOT NULL
              AND a.resource_type = 'report'
        )
        INSERT INTO bip.user_report_activity
            (user_id, report_id, first_viewed_at, last_viewed_at, view_count)
        SELECT
            rv.actor_user_id,
            rv.report_id,
            MIN(rv.occurred_at_utc),
            MAX(rv.occurred_at_utc),
            COUNT(*)
        FROM report_views rv
        JOIN bip.users u
          ON u.id = rv.actor_user_id
         AND u.external_id = rv.actor_label
        JOIN bip.reports r ON r.id = rv.report_id
        WHERE rv.report_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM bip.local_admins la
              WHERE la.id = rv.actor_user_id
                AND la.username = rv.actor_label
          )
        GROUP BY rv.actor_user_id, rv.report_id
        ON CONFLICT (user_id, report_id) DO NOTHING
        """
    )
    op.execute(
        """
        WITH report_views AS (
            SELECT
                a.actor_user_id,
                a.actor_label,
                CASE
                    WHEN a.resource_id ~ '^[0-9]+$' THEN a.resource_id::bigint
                END AS report_id,
                a.occurred_at_utc
            FROM bip.audit_logs a
            WHERE a.action = 'report_view'
              AND a.result = 'success'
              AND a.actor_user_id IS NOT NULL
              AND a.resource_type = 'report'
        )
        INSERT INTO bip.report_view_daily_stats (report_id, viewed_date, view_count)
        SELECT
            rv.report_id,
            rv.occurred_at_utc::date,
            COUNT(*)
        FROM report_views rv
        JOIN bip.users u
          ON u.id = rv.actor_user_id
         AND u.external_id = rv.actor_label
        JOIN bip.reports r ON r.id = rv.report_id
        WHERE rv.report_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM bip.local_admins la
              WHERE la.id = rv.actor_user_id
                AND la.username = rv.actor_label
          )
        GROUP BY rv.report_id, rv.occurred_at_utc::date
        ON CONFLICT (report_id, viewed_date) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_report_view_daily_stats_date",
        table_name="report_view_daily_stats",
        schema=SCHEMA,
    )
    op.drop_table("report_view_daily_stats", schema=SCHEMA)
    op.drop_index(
        "ix_user_report_activity_report",
        table_name="user_report_activity",
        schema=SCHEMA,
    )
    op.drop_index(
        "ix_user_report_activity_user_last_viewed",
        table_name="user_report_activity",
        schema=SCHEMA,
    )
    op.drop_table("user_report_activity", schema=SCHEMA)
    op.drop_column("reports", "published_at", schema=SCHEMA)
