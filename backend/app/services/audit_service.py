"""Audit_Service — 감사 로그 기록 (시크릿 미기록 보장).

감사 로그는 보안 감사와 통계 활동 원장을 함께 제공한다. 분석 대상 이벤트는 당시
사용자·부서·레포트·최상위 폴더·작성자 스냅샷을 저장해 이후 조직/폴더 변경이 과거
통계를 바꾸지 않도록 한다.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.http_utils import get_current_client_ip
from app.models.auth import Department, User
from app.models.log import AuditLog
from app.models.report import ReportFolder

# meta에 허용되는 키만 통과 (시크릿 차단 화이트리스트)
_ALLOWED_META_KEYS = frozenset({
    "emp_no", "username", "auth", "report_id", "report_name", "dataset_id", "workspace_id",
    "group_id", "role_id", "subject_type", "subject_id", "permission",
    "mail_schedule_id", "mail_job_id", "export_id", "export_job_id", "export_format",
    "scope", "page_name", "with_view_state", "folder_id", "owner_user_id", "owner_label",
    "endpoint", "status_code", "error_type", "reason",
    "before", "after", "target", "count",
    "request_id", "request_type", "status", "session_id",
})

# 절대 기록 금지 (방어적 차단)
_FORBIDDEN_KEYS = frozenset({
    "password", "passwd", "login_pwd", "secret", "client_secret",
    "token", "access_token", "embed_token", "authorization",
})


def _sanitize_meta(meta: dict | None) -> dict | None:
    """화이트리스트 키만 남기고, 금지 키는 제거."""
    if not meta:
        return None
    clean = {}
    for key, value in meta.items():
        if key in _FORBIDDEN_KEYS:
            continue
        if key in _ALLOWED_META_KEYS:
            clean[key] = value
    return clean or None


async def build_audit_snapshot(
    db: AsyncSession,
    *,
    actor_user_id: int | None = None,
    report: Any | None = None,
) -> dict[str, Any]:
    """이벤트 당시 사용자 조직과 레포트 소속/작성자 값을 append_audit 인자로 반환한다.

    local_admin은 users와 별도 PK 공간이므로 호출부에서 actor_user_id를 넘기지 않는다.
    report는 ORM Report와 같은 속성을 가진 객체면 충분하게 duck typing한다.
    """
    snapshot: dict[str, Any] = {}
    if actor_user_id is not None:
        row = (await db.execute(
            select(User, Department.name)
            .outerjoin(Department, Department.id == User.department_id)
            .where(User.id == actor_user_id)
        )).first()
        if row is not None:
            user, department_name = row
            snapshot.update({
                "actor_name_snapshot": user.name,
                "actor_emp_no_snapshot": user.external_id,
                "actor_department_id": user.department_id,
                "actor_department_name": department_name,
            })

    if report is not None:
        root = None
        folder_id = getattr(report, "folder_id", None)
        seen: set[int] = set()
        while folder_id is not None and folder_id not in seen:
            seen.add(folder_id)
            folder = await db.scalar(select(ReportFolder).where(ReportFolder.id == folder_id))
            if folder is None:
                break
            root = folder
            folder_id = folder.parent_id
        snapshot.update({
            "report_name_snapshot": (
                getattr(report, "display_name", None)
                or getattr(report, "report_name", None)
                or getattr(report, "report_id", None)
            ),
            "report_company_id": root.id if root is not None else None,
            "report_company_name": root.name if root is not None else None,
            "report_owner_user_id": getattr(report, "created_by_user_id", None),
            "report_owner_label": (
                getattr(report, "created_by_label", None)
                or getattr(report, "author_label", None)
            ),
        })
    return snapshot


async def append_audit(
    db: AsyncSession,
    *,
    action: str,
    result: str,
    actor_user_id: int | None = None,
    actor_label: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    event_key: str | None = None,
    actor_name_snapshot: str | None = None,
    actor_emp_no_snapshot: str | None = None,
    actor_department_id: int | None = None,
    actor_department_name: str | None = None,
    report_name_snapshot: str | None = None,
    report_company_id: int | None = None,
    report_company_name: str | None = None,
    report_owner_user_id: int | None = None,
    report_owner_label: str | None = None,
    duration_seconds: int | None = None,
    meta: dict | None = None,
) -> int:
    """감사 로그 1건 기록 후 id를 반환한다.

    event_key는 렌더 완료 조회 세션처럼 재시도 가능한 이벤트의 멱등 키다. DB unique
    index가 중복을 최종 방어한다. meta는 시크릿 차단 화이트리스트를 적용한다.
    """
    entry = AuditLog(
        actor_user_id=actor_user_id,
        actor_label=actor_label,
        actor_name_snapshot=actor_name_snapshot,
        actor_emp_no_snapshot=actor_emp_no_snapshot,
        actor_department_id=actor_department_id,
        actor_department_name=actor_department_name,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        event_key=event_key,
        report_name_snapshot=report_name_snapshot,
        report_company_id=report_company_id,
        report_company_name=report_company_name,
        report_owner_user_id=report_owner_user_id,
        report_owner_label=report_owner_label,
        result=result,
        duration_seconds=duration_seconds,
        meta=_sanitize_meta(meta),
        ip_address=get_current_client_ip(),
    )
    db.add(entry)
    await db.flush()
    return entry.id


async def record_powerbi_failure(
    db: AsyncSession,
    *,
    endpoint: str | None = None,
    status_code: int | None = None,
    error_type: str | None = None,
    reason: str | None = None,
    actor_user_id: int | None = None,
) -> None:
    """PowerBI 공통 오류를 audit_logs(action=powerbi_api_failure)에 기록한다."""
    from app.core.constants import AuditAction

    await append_audit(
        db,
        action=AuditAction.POWERBI_API_FAILURE,
        result="failure",
        actor_user_id=actor_user_id,
        resource_type="powerbi",
        meta={
            "endpoint": endpoint,
            "status_code": status_code,
            "error_type": error_type,
            "reason": reason,
        },
    )
