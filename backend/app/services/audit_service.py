"""Audit_Service — 감사 로그 기록 (시크릿 미기록 보장).

design.md "감사 로그 설계"(R35) 참조. audit_logs append 전용.
meta는 화이트리스트 키만 기록하여 토큰/비밀번호/secret이 절대 남지 않게 한다(Property 10).
occurred_at_utc는 DB server_default(now())로 UTC 저장.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.log import AuditLog

# meta에 허용되는 키만 통과 (시크릿 차단 화이트리스트)
_ALLOWED_META_KEYS = frozenset({
    "emp_no", "username", "report_id", "dataset_id", "workspace_id",
    "group_id", "role_id", "subject_type", "subject_id", "permission",
    "mail_schedule_id", "mail_job_id", "export_id", "folder_id",
    "endpoint", "status_code", "error_type", "reason",
    "before", "after", "target", "count",
    "request_id", "request_type", "status",
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
    for k, v in meta.items():
        if k in _FORBIDDEN_KEYS:
            continue
        if k in _ALLOWED_META_KEYS:
            clean[k] = v
    return clean or None

async def append_audit(
    db: AsyncSession,
    *,
    action: str,
    result: str,
    actor_user_id: int | None = None,
    actor_label: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    meta: dict | None = None,
) -> int:
    """감사 로그 1건 기록. 시크릿은 _sanitize_meta로 차단. 생성된 로그 id를 반환한다
    (호출부 대부분은 무시하지만, report_view는 체류시간 갱신을 위해 필요로 한다)."""
    entry = AuditLog(
        actor_user_id=actor_user_id,
        actor_label=actor_label,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        result=result,
        meta=_sanitize_meta(meta),
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
    """PowerBI 공통 오류를 audit_logs(action=powerbi_api_failure)에 기록한다.

    PowerBI_Client 호출 실패가 전역 오류 핸들러(공통 오류 경로)로 전파될 때
    호출된다. 시크릿은 _sanitize_meta 화이트리스트로 차단된다(Property 10).
    """
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
