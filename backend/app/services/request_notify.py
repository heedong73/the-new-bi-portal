"""서비스 센터 알림 메일 (R17 고도화).

요청 상태 변경/댓글 등 이벤트 발생 시 관련자에게 메일로 알린다.

- 수신자 이메일은 라우트에서 DB로 미리 해석하여 전달한다(백그라운드 태스크는
  DB 세션 없이 SMTP 발송만 수행).
- 발송은 best-effort: 실패해도 요청 처리 흐름을 막지 않는다.
- ``REQUEST_NOTIFY_ENABLED=false`` 또는 수신자 없음이면 발송하지 않는다.
- ``APP_MODE=mock`` 에서는 실제 SMTP 없이 로그만 남긴다(mail_service 재사용).
"""
from __future__ import annotations

import html
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import RoleCode
from app.core.logging import get_logger
from app.models.auth import Role, User, UserRole
from app.services.mail.mail_service import send_with_retry

logger = get_logger(__name__)

_APP = "BI 포털"

_TYPE_LABEL = {"inquiry": "문의", "error": "에러", "improvement": "개선요청"}
_STATUS_LABEL = {
    "pending": "대기",
    "received": "접수",
    "rejected": "반려",
    "done": "완료",
}


# ---------------------------------------------------------------------------
# 수신자 해석 (DB)
# ---------------------------------------------------------------------------

async def resolve_operator_emails(db: AsyncSession) -> list[str]:
    """활성 System_Operator 사용자들의 이메일 목록(중복 제거)."""
    rows = (
        await db.execute(
            select(User.email)
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                Role.code == RoleCode.SYSTEM_OPERATOR.value,
                User.is_active.is_(True),
                User.email.is_not(None),
            )
            .distinct()
        )
    ).all()
    return [e for (e,) in rows if e]


async def resolve_user_email(db: AsyncSession, user_id: int | None) -> str | None:
    """user_id의 이메일."""
    if user_id is None:
        return None
    return await db.scalar(select(User.email).where(User.id == user_id))


# ---------------------------------------------------------------------------
# 본문 빌더 (사용자 입력은 escape)
# ---------------------------------------------------------------------------

def _wrap(title: str, rows: list[tuple[str, str]], extra_html: str = "") -> str:
    items = "".join(
        f'<tr><td style="padding:4px 12px 4px 0;color:#64748b;white-space:nowrap;">{html.escape(k)}</td>'
        f'<td style="padding:4px 0;color:#0f172a;">{v}</td></tr>'
        for k, v in rows
    )
    return (
        f'<div style="font-family:system-ui,Segoe UI,sans-serif;font-size:14px;color:#0f172a;">'
        f'<h2 style="font-size:16px;margin:0 0 12px;">{html.escape(title)}</h2>'
        f'<table style="border-collapse:collapse;">{items}</table>'
        f'{extra_html}'
        f'<p style="margin-top:16px;color:#94a3b8;font-size:12px;">본 메일은 {_APP} 서비스 센터에서 자동 발송되었습니다.</p>'
        f'</div>'
    )


def build_new_request(*, title: str, requester_name: str, request_type: str) -> tuple[str, str]:
    subject = f"[{_APP}] 새 서비스 요청: {title}"
    body = _wrap(
        "새 서비스 요청이 등록되었습니다.",
        [
            ("제목", html.escape(title)),
            ("요청자", html.escape(requester_name or "-")),
            ("유형", _TYPE_LABEL.get(request_type, request_type)),
        ],
    )
    return subject, body


def build_status_update(
    *, title: str, status: str, operator_response: str | None, reject_reason: str | None
) -> tuple[str, str]:
    subject = f"[{_APP}] 요청 상태 변경({_STATUS_LABEL.get(status, status)}): {title}"
    extra = ""
    if status == "rejected" and reject_reason:
        extra = (
            f'<div style="margin-top:12px;padding:10px 12px;background:#fef2f2;border-radius:8px;color:#b91c1c;">'
            f'<b>반려 사유</b><br>{html.escape(reject_reason)}</div>'
        )
    elif operator_response:
        extra = (
            f'<div style="margin-top:12px;padding:10px 12px;background:#f8fafc;border-radius:8px;color:#334155;">'
            f'<b>운영자 응답</b><br>{html.escape(operator_response)}</div>'
        )
    body = _wrap(
        "요청 처리 상태가 변경되었습니다.",
        [("제목", html.escape(title)), ("상태", _STATUS_LABEL.get(status, status))],
        extra_html=extra,
    )
    return subject, body


def build_new_comment(*, title: str, author_label: str, snippet: str) -> tuple[str, str]:
    subject = f"[{_APP}] 요청에 새 댓글: {title}"
    extra = (
        f'<div style="margin-top:12px;padding:10px 12px;background:#f8fafc;border-radius:8px;color:#334155;">'
        f'{html.escape(snippet)}</div>'
    )
    body = _wrap(
        "요청에 새 댓글이 등록되었습니다.",
        [("제목", html.escape(title)), ("작성자", html.escape(author_label or "-"))],
        extra_html=extra,
    )
    return subject, body


# ---------------------------------------------------------------------------
# 발송 (백그라운드 태스크 진입점) — best-effort
# ---------------------------------------------------------------------------

async def send_notification(subject: str, recipients: list[str], html_body: str) -> None:
    """알림 메일 발송. 비활성/수신자 없음/실패는 조용히 무시(요청 흐름 비차단)."""
    if not settings.REQUEST_NOTIFY_ENABLED:
        return
    clean = [r for r in dict.fromkeys(recipients) if r]
    if not clean:
        return

    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = ", ".join(clean)
    msg["Subject"] = subject
    msg.set_content("이 메일은 HTML 형식입니다.")
    msg.add_alternative(html_body, subtype="html")

    try:
        await send_with_retry(msg, clean)
    except Exception as exc:  # noqa: BLE001 - 알림은 best-effort
        logger.warning("request_notify_failed", subject=subject, error=str(exc))
