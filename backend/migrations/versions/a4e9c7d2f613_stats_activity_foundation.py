"""통계 활동 세션·스냅샷·담당임원 역할 기반 추가.

Revision ID: a4e9c7d2f613
Revises: f2d6a8c4b917
Create Date: 2026-07-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "a4e9c7d2f613"
down_revision = "f2d6a8c4b917"
branch_labels = None
depends_on = None

SCHEMA = "bip"
TABLE = "audit_logs"


def upgrade() -> None:
    columns = (
        sa.Column("event_key", sa.String(length=64), nullable=True),
        sa.Column("actor_name_snapshot", sa.String(length=255), nullable=True),
        sa.Column("actor_emp_no_snapshot", sa.String(length=64), nullable=True),
        sa.Column("actor_department_id", sa.BigInteger(), nullable=True),
        sa.Column("actor_department_name", sa.String(length=255), nullable=True),
        sa.Column("report_name_snapshot", sa.String(length=255), nullable=True),
        sa.Column("report_company_id", sa.BigInteger(), nullable=True),
        sa.Column("report_company_name", sa.String(length=255), nullable=True),
        sa.Column("report_owner_user_id", sa.BigInteger(), nullable=True),
        sa.Column("report_owner_label", sa.String(length=255), nullable=True),
    )
    for column in columns:
        op.add_column(TABLE, column, schema=SCHEMA)
    op.create_index("uq_audit_event_key", TABLE, ["event_key"], unique=True, schema=SCHEMA)
    op.create_index(
        "idx_audit_actor_department_action", TABLE,
        ["actor_department_id", "action"], schema=SCHEMA,
    )
    op.create_index(
        "idx_audit_report_company_action", TABLE,
        ["report_company_id", "action"], schema=SCHEMA,
    )
    op.create_index(
        "idx_audit_report_owner_action", TABLE,
        ["report_owner_user_id", "action"], schema=SCHEMA,
    )

    # users/local_admins는 독립 PK 시퀀스다. 과거 로컬 관리자가 작성한 레포트의
    # creator ID와 자동 VIEW_STATS grant가 동일 숫자의 일반 사용자에게 귀속되지 않도록
    # 로컬 관리자 principal을 기존 즐겨찾기 규칙과 같은 음수 ID namespace로 분리한다.
    # 동일 transaction에서 생성돼 report와 created_at이 같은 grant만 자동 grant로 본다.
    op.execute(sa.text(f"""
        WITH local_admin_reports AS (
            SELECT r.id, r.created_by_user_id, r.created_at
            FROM {SCHEMA}.reports AS r
            JOIN {SCHEMA}.local_admins AS la ON r.created_by_user_id = la.id
            WHERE r.created_by_user_id > 0
              AND r.created_by_label IN (
                  la.username,
                  la.username || '(' || la.username || ')'
              )
        )
        UPDATE {SCHEMA}.report_permissions AS rp
        SET subject_id = -rp.subject_id
        FROM local_admin_reports AS r
        WHERE rp.report_id = r.id
          AND rp.subject_type = 'user'
          AND rp.subject_id = r.created_by_user_id
          AND rp.permission = 'VIEW_STATS'
          AND rp.created_at = r.created_at
    """))
    op.execute(sa.text(f"""
        UPDATE {SCHEMA}.reports AS r
        SET created_by_user_id = -r.created_by_user_id
        FROM {SCHEMA}.local_admins AS la
        WHERE r.created_by_user_id = la.id
          AND r.created_by_user_id > 0
          AND r.created_by_label IN (
              la.username,
              la.username || '(' || la.username || ')'
          )
    """))

    # 과거 로컬 관리자 감사 actor도 같은 숫자의 일반 사용자로 오귀속되지 않도록
    # actor_label=username인 확실한 행만 NULL로 정규화한다. downgrade 시 원래 ID를
    # migration 전용 meta 키에서 복원한다.
    op.execute(sa.text(f"""
        UPDATE {SCHEMA}.audit_logs AS a
        SET meta = COALESCE(a.meta, '{{}}'::jsonb) || jsonb_build_object(
                '_stats_migration_local_admin_id', a.actor_user_id
            ),
            actor_user_id = NULL
        FROM {SCHEMA}.local_admins AS la
        WHERE a.actor_user_id = la.id
          AND a.actor_label = la.username
    """))

    # 구버전 PBIX 업로드/교체 감사 행은 worker 완료가 아니라 enqueue 직후 success로
    # 기록됐다. 완료된 lifecycle 수정으로 오인하지 않도록 accepted로 정규화하고,
    # pbix_upload의 잘못된 create action도 update로 보정한다. 원래 action/result는
    # downgrade에서 되돌릴 수 있도록 migration 전용 meta 키에 보존한다.
    op.execute(sa.text(f"""
        UPDATE {SCHEMA}.audit_logs
        SET action = CASE
                WHEN action = 'report_create' THEN 'report_update'
                ELSE action
            END,
            result = 'accepted',
            meta = COALESCE(meta, '{{}}'::jsonb) || jsonb_build_object(
                '_stats_migration_original_action', action,
                '_stats_migration_original_result', result
            )
        WHERE result = 'success'
          AND (
              (action = 'report_create' AND meta ->> 'target' = 'pbix_upload')
              OR
              (action = 'report_update' AND meta ->> 'target' = 'replace_pbix')
          )
    """))

    # 동일 현재 레포트에 성공 create가 여러 건이면 최초 1건만 canonical create로 두고
    # 나머지는 update로 보정한다. 원본 action은 downgrade에서 복원한다.
    op.execute(sa.text(f"""
        WITH ranked AS (
            SELECT a.id,
                   row_number() OVER (
                       PARTITION BY a.resource_id
                       ORDER BY a.occurred_at_utc, a.id
                   ) AS sequence
            FROM {SCHEMA}.audit_logs AS a
            JOIN {SCHEMA}.reports AS r ON a.resource_id = r.id::text
            WHERE a.action = 'report_create'
              AND a.result = 'success'
              AND a.resource_type = 'report'
        )
        UPDATE {SCHEMA}.audit_logs AS a
        SET action = 'report_update',
            meta = COALESCE(a.meta, '{{}}'::jsonb) || jsonb_build_object(
                '_stats_migration_original_action', 'report_create'
            )
        FROM ranked
        WHERE a.id = ranked.id AND ranked.sequence > 1
    """))

    # 기존 canonical create에도 worker와 같은 멱등 키를 부여한다.
    op.execute(sa.text(f"""
        UPDATE {SCHEMA}.audit_logs AS a
        SET event_key = 'report-create:' || a.resource_id
        FROM {SCHEMA}.reports AS r
        WHERE a.action = 'report_create'
          AND a.result = 'success'
          AND a.resource_type = 'report'
          AND a.resource_id = r.id::text
          AND a.event_key IS NULL
    """))

    # 기존 감사 행도 현재 기준으로 가능한 스냅샷을 채운다. 이후 이벤트는 기록 시점 값을 저장한다.
    op.execute(sa.text(f"""
        WITH actor_snapshots AS (
            SELECT u.id, u.name, u.external_id, u.department_id, d.name AS department_name
            FROM {SCHEMA}.users AS u
            LEFT JOIN {SCHEMA}.departments AS d ON d.id = u.department_id
        )
        UPDATE {SCHEMA}.audit_logs AS a
        SET actor_name_snapshot = s.name,
            actor_emp_no_snapshot = s.external_id,
            actor_department_id = s.department_id,
            actor_department_name = s.department_name
        FROM actor_snapshots AS s
        WHERE a.actor_user_id = s.id
    """))
    op.execute(sa.text(f"""
        WITH RECURSIVE folder_roots(folder_id, root_id, root_name) AS (
            SELECT id, id, name
            FROM {SCHEMA}.report_folders
            WHERE parent_id IS NULL
            UNION ALL
            SELECT child.id, roots.root_id, roots.root_name
            FROM {SCHEMA}.report_folders AS child
            JOIN folder_roots AS roots ON child.parent_id = roots.folder_id
        ), report_snapshots AS (
            SELECT r.id,
                   COALESCE(r.display_name, r.report_name, r.report_id) AS report_name,
                   roots.root_id,
                   roots.root_name,
                   CASE WHEN r.created_by_user_id > 0 THEN r.created_by_user_id END AS created_by_user_id,
                   COALESCE(r.created_by_label, r.author_label) AS owner_label
            FROM {SCHEMA}.reports AS r
            LEFT JOIN folder_roots AS roots ON roots.folder_id = r.folder_id
        )
        UPDATE {SCHEMA}.audit_logs AS a
        SET report_name_snapshot = s.report_name,
            report_company_id = s.root_id,
            report_company_name = s.root_name,
            report_owner_user_id = s.created_by_user_id,
            report_owner_label = s.owner_label
        FROM report_snapshots AS s
        WHERE a.resource_type = 'report' AND a.resource_id = s.id::text
    """))

    # 현재 카탈로그 중 생성 감사 이벤트가 없던 레포트는 created_at 시점의 합성 이벤트로
    # 1회 보정한다. 이후 신규 PBIX 반영은 worker가 실제 성공 후 동일 원장을 기록한다.
    op.execute(sa.text(f"""
        WITH RECURSIVE folder_roots(folder_id, root_id, root_name) AS (
            SELECT id, id, name
            FROM {SCHEMA}.report_folders
            WHERE parent_id IS NULL
            UNION ALL
            SELECT child.id, roots.root_id, roots.root_name
            FROM {SCHEMA}.report_folders AS child
            JOIN folder_roots AS roots ON child.parent_id = roots.folder_id
        )
        INSERT INTO {SCHEMA}.audit_logs (
            actor_user_id, actor_label,
            actor_name_snapshot, actor_emp_no_snapshot,
            actor_department_id, actor_department_name,
            action, resource_type, resource_id, event_key,
            report_name_snapshot, report_company_id, report_company_name,
            report_owner_user_id, report_owner_label,
            result, occurred_at_utc, meta
        )
        SELECT
            CASE WHEN r.created_by_user_id > 0 THEN r.created_by_user_id END,
            COALESCE(r.created_by_label, r.author_label),
            u.name,
            u.external_id,
            u.department_id,
            d.name,
            'report_create',
            'report',
            r.id::text,
            'report-create:' || r.id::text,
            COALESCE(r.display_name, r.report_name, r.report_id),
            roots.root_id,
            roots.root_name,
            CASE WHEN r.created_by_user_id > 0 THEN r.created_by_user_id END,
            COALESCE(r.created_by_label, r.author_label),
            'success',
            r.created_at,
            jsonb_build_object('report_id', r.id, 'target', 'migration_backfill')
        FROM {SCHEMA}.reports AS r
        LEFT JOIN folder_roots AS roots ON roots.folder_id = r.folder_id
        LEFT JOIN {SCHEMA}.users AS u ON u.id = r.created_by_user_id
        LEFT JOIN {SCHEMA}.departments AS d ON d.id = u.department_id
        WHERE NOT EXISTS (
            SELECT 1
            FROM {SCHEMA}.audit_logs AS a
            WHERE a.action = 'report_create'
              AND a.result = 'success'
              AND a.resource_type = 'report'
              AND a.resource_id = r.id::text
        )
        ON CONFLICT (event_key) DO NOTHING
    """))

    # 기존 작성자는 API 스코프에서 ownership과 VIEW_STATS의 합집합으로 즉시 보장한다.
    # 권한 테이블 backfill은 downgrade 시 기존 행과 구분할 수 없어 의도적으로 수행하지 않는다.

    # 관리자 권한 없이 전체 통계만 읽는 담당임원 역할.
    op.execute(sa.text(f"""
        INSERT INTO {SCHEMA}.roles (code, name)
        VALUES ('Executive_Stats_Reader', '담당임원 통계 열람자')
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    """))


def downgrade() -> None:
    op.execute(sa.text(f"""
        DELETE FROM {SCHEMA}.audit_logs
        WHERE event_key LIKE 'report-create:%'
          AND meta ->> 'target' = 'migration_backfill'
    """))
    op.execute(sa.text(f"""
        UPDATE {SCHEMA}.audit_logs
        SET action = COALESCE(
                meta ->> '_stats_migration_original_action', action
            ),
            result = COALESCE(
                meta ->> '_stats_migration_original_result', result
            ),
            meta = meta
                - '_stats_migration_original_action'
                - '_stats_migration_original_result'
        WHERE meta ? '_stats_migration_original_action'
           OR meta ? '_stats_migration_original_result'
    """))
    op.execute(sa.text(f"""
        UPDATE {SCHEMA}.audit_logs
        SET actor_user_id = (meta ->> '_stats_migration_local_admin_id')::bigint,
            meta = meta - '_stats_migration_local_admin_id'
        WHERE meta ? '_stats_migration_local_admin_id'
    """))

    # migration 이후 동일 일반 사용자에게 같은 grant가 추가됐다면 unique 충돌을 피하면서
    # 의미상 중복인 음수 principal 행을 제거하고, 나머지는 원래 양수 ID로 복원한다.
    op.execute(sa.text(f"""
        WITH local_admin_reports AS (
            SELECT r.id, r.created_by_user_id, r.created_at
            FROM {SCHEMA}.reports AS r
            JOIN {SCHEMA}.local_admins AS la ON r.created_by_user_id = -la.id
            WHERE r.created_by_user_id < 0
              AND r.created_by_label IN (
                  la.username,
                  la.username || '(' || la.username || ')'
              )
        )
        DELETE FROM {SCHEMA}.report_permissions AS encoded
        USING local_admin_reports AS r
        WHERE encoded.report_id = r.id
          AND encoded.subject_type = 'user'
          AND encoded.subject_id = r.created_by_user_id
          AND encoded.permission = 'VIEW_STATS'
          AND encoded.created_at = r.created_at
          AND EXISTS (
              SELECT 1
              FROM {SCHEMA}.report_permissions AS restored
              WHERE restored.report_id = encoded.report_id
                AND restored.subject_type = encoded.subject_type
                AND restored.subject_id = -encoded.subject_id
                AND restored.permission = encoded.permission
          )
    """))
    op.execute(sa.text(f"""
        WITH local_admin_reports AS (
            SELECT r.id, r.created_by_user_id, r.created_at
            FROM {SCHEMA}.reports AS r
            JOIN {SCHEMA}.local_admins AS la ON r.created_by_user_id = -la.id
            WHERE r.created_by_user_id < 0
              AND r.created_by_label IN (
                  la.username,
                  la.username || '(' || la.username || ')'
              )
        )
        UPDATE {SCHEMA}.report_permissions AS rp
        SET subject_id = -rp.subject_id
        FROM local_admin_reports AS r
        WHERE rp.report_id = r.id
          AND rp.subject_type = 'user'
          AND rp.subject_id = r.created_by_user_id
          AND rp.permission = 'VIEW_STATS'
          AND rp.created_at = r.created_at
    """))
    op.execute(sa.text(f"""
        UPDATE {SCHEMA}.reports AS r
        SET created_by_user_id = -r.created_by_user_id
        FROM {SCHEMA}.local_admins AS la
        WHERE r.created_by_user_id = -la.id
          AND r.created_by_user_id < 0
          AND r.created_by_label IN (
              la.username,
              la.username || '(' || la.username || ')'
          )
    """))
    op.execute(sa.text(f"""
        DELETE FROM {SCHEMA}.user_roles
        WHERE role_id IN (SELECT id FROM {SCHEMA}.roles WHERE code = 'Executive_Stats_Reader')
    """))
    op.execute(sa.text(f"DELETE FROM {SCHEMA}.roles WHERE code = 'Executive_Stats_Reader'"))
    for index_name in (
        "idx_audit_report_owner_action",
        "idx_audit_report_company_action",
        "idx_audit_actor_department_action",
        "uq_audit_event_key",
    ):
        op.drop_index(index_name, table_name=TABLE, schema=SCHEMA)
    for name in (
        "report_owner_label", "report_owner_user_id", "report_company_name",
        "report_company_id", "report_name_snapshot", "actor_department_name",
        "actor_department_id", "actor_emp_no_snapshot", "actor_name_snapshot", "event_key",
    ):
        op.drop_column(TABLE, name, schema=SCHEMA)
