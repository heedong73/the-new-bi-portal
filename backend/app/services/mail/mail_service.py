"""Mail Service — SMTP 발송 (multipart/related + CID inline) + 재시도 + Audit (T-30).

design.md "메일 발송"(R16.10, R16.16, R34) 참조.

- 본문 이미지는 ``multipart/related`` + ``Content-ID(cid:)`` 로 inline 첨부한다
  (외부 URL/인증 불필요, 외부 이미지 차단 영향 없음).
- 발송 실패 시 ``MAIL_RETRY_MAX`` 회까지 재시도한다.
- 발송 결과(성공/실패)를 Audit_Log(action=mail_send)에 기록한다.
- mock 모드(APP_MODE=mock): 실제 SMTP 연결 없이 발송 성공을 시뮬레이션한다.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from email.message import EmailMessage

import aiosmtplib
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import AuditAction
from app.core.logging import get_logger
from app.services.audit_service import append_audit
from app.services.mail.recipients import ResolvedRecipients
from app.services.mail.template import (
    InlineImage,
    assemble_body,
    default_context,
    html_to_text,
    render_subject,
)

logger = get_logger(__name__)


@dataclass
class MailAttachment:
    """본문 inline 첨부 이미지 1건."""

    cid: str
    data: bytes
    mime_subtype: str = "png"  # image/<subtype>
    caption: str | None = None
    display_width: str | None = None


def build_message(
    *,
    subject: str,
    html_body: str,
    sender: str,
    to: list[str],
    attachments: list[MailAttachment],
    cc: list[str] | None = None,
) -> EmailMessage:
    """multipart/related EmailMessage 조립. HTML 본문 + CID inline 이미지.

    To/Cc 헤더만 설정하고 Bcc 헤더는 넣지 않는다 — 숨은참조는 SMTP envelope
    발송 대상에만 포함되어 다른 수신자에게 노출되지 않는다. to 가 비어 있으면
    (참조/숨은참조 전용 발송) 유효 헤더를 위해 To 를 'undisclosed-recipients:;' 로 둔다.
    """
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = ", ".join(to) if to else "undisclosed-recipients:;"
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject

    # 평문 대체본(text/plain): 모바일 그룹웨어 앱 알림/미리보기에 노출되므로
    # 본문 텍스트(서식 제거)를 넣고, 텍스트가 없으면 제목을 사용한다.
    plain = html_to_text(html_body) or subject
    msg.set_content(plain)
    msg.add_alternative(html_body, subtype="html")

    # HTML 파트에 이미지를 related 로 첨부 (cid 연결)
    html_part = msg.get_payload()[-1]
    for att in attachments:
        html_part.add_related(
            att.data,
            maintype="image",
            subtype=att.mime_subtype,
            cid=f"<{att.cid}>",
        )
    return msg


async def _send_once(message: EmailMessage, recipients: list[str]) -> None:
    """SMTP 1회 발송. 실패 시 예외 전파."""
    if settings.APP_MODE == "mock":
        logger.info("smtp_mock_send", to_count=len(recipients))
        return

    await aiosmtplib.send(
        message,
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        username=settings.SMTP_USERNAME if settings.SMTP_USE_AUTH else None,
        password=settings.SMTP_PASSWORD if settings.SMTP_USE_AUTH else None,
        start_tls=settings.SMTP_STARTTLS,
        recipients=recipients,
    )


async def send_with_retry(message: EmailMessage, recipients: list[str]) -> None:
    """MAIL_RETRY_MAX 회까지 재시도하며 발송. 모든 시도 실패 시 마지막 예외 전파."""
    attempts = max(1, settings.MAIL_RETRY_MAX)
    last_exc: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            await _send_once(message, recipients)
            logger.info("smtp_sent", attempt=attempt, to_count=len(recipients))
            return
        except Exception as exc:  # noqa: BLE001 - 재시도 위해 광범위 포착
            last_exc = exc
            logger.warning("smtp_send_failed", attempt=attempt, error=str(exc))
            if attempt < attempts:
                await asyncio.sleep(min(2 ** attempt, 10))
    assert last_exc is not None
    raise last_exc


async def deliver_mail_job(
    db: AsyncSession,
    *,
    mail_job_id: int,
    report_id: int,
    report_name: str,
    subject_template: str | None,
    body_header: str | None,
    body_footer: str | None,
    schedule_title: str,
    recipients: ResolvedRecipients,
    attachments: list[MailAttachment],
    sender_email: str | None = None,
) -> bool:
    """메일 본문 조립 → 발송(재시도) → Audit 기록. 성공 시 True.

    sender_email 이 지정되면 그 주소를 From 으로 쓰고, 없으면 서버 기본값(SMTP_FROM).
    recipients 는 받는사람/참조/숨은참조로 그룹화된 ResolvedRecipients — To/Cc 헤더는
    to/cc 로 구성하고, 실제 발송(envelope)은 bcc 포함 전체를 대상으로 한다.
    수신자가 하나도 없으면 발송하지 않고 실패 처리한다.
    """
    envelope = recipients.envelope
    if not envelope:
        await append_audit(
            db, action=AuditAction.MAIL_SEND, result="failure",
            resource_type="mail_job", resource_id=str(mail_job_id),
            meta={"mail_job_id": mail_job_id, "report_id": report_id,
                  "reason": "수신자 없음", "count": 0},
        )
        await db.commit()
        logger.warning("mail_no_recipients", mail_job_id=mail_job_id)
        return False

    context = default_context(report_name)
    images = [
        InlineImage(cid=a.cid, caption=a.caption, display_width=a.display_width)
        for a in attachments
    ]
    html_body = assemble_body(
        body_header=body_header,
        body_footer=body_footer,
        images=images,
        context=context,
    )
    subject = render_subject(subject_template, context, fallback=schedule_title)
    message = build_message(
        subject=subject,
        html_body=html_body,
        sender=sender_email or settings.SMTP_FROM,
        to=recipients.to,
        cc=recipients.cc,
        attachments=attachments,
    )

    try:
        await send_with_retry(message, envelope)
    except Exception as exc:  # noqa: BLE001
        await append_audit(
            db, action=AuditAction.MAIL_SEND, result="failure",
            resource_type="mail_job", resource_id=str(mail_job_id),
            meta={"mail_job_id": mail_job_id, "report_id": report_id,
                  "reason": str(exc), "count": recipients.total},
        )
        await db.commit()
        logger.error("mail_send_failed", mail_job_id=mail_job_id, error=str(exc))
        return False

    await append_audit(
        db, action=AuditAction.MAIL_SEND, result="success",
        resource_type="mail_job", resource_id=str(mail_job_id),
        meta={"mail_job_id": mail_job_id, "report_id": report_id,
              "count": recipients.total, "to": len(recipients.to),
              "cc": len(recipients.cc), "bcc": len(recipients.bcc)},
    )
    await db.commit()
    logger.info(
        "mail_sent", mail_job_id=mail_job_id,
        to=len(recipients.to), cc=len(recipients.cc), bcc=len(recipients.bcc),
    )
    return True
