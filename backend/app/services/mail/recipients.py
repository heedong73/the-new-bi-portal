"""수신자 전개 — mail_recipients 참조를 실제 이메일 주소 집합으로 펼친다 (T-30).

design.md "수신자(mail_recipients) 해석"(R16.14) 참조.

전개 규칙(발송 시점 해석):
  - USER       → 해당 사용자(users.id)의 email
  - GROUP      → 그룹 소속원(user_group_members) 전원의 email
  - DEPARTMENT → 해당 부서(users.department_id) 소속원 전원의 email
  - EMAIL      → 입력값 그대로

전개 결과는 소문자 정규화 + 중복 제거한다. 메일이 없는 사용자는 스킵한다.
그룹원/부서원 변경은 발송 시점 해석이므로 다음 발송에 자동 반영된다.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import RecipientType
from app.core.logging import get_logger
from app.models.auth import User
from app.models.mail import MailRecipient
from app.models.portal import UserGroupMember

logger = get_logger(__name__)


def _normalize(email: str | None) -> str | None:
    """이메일 정규화: 공백 제거 + 소문자. 빈 값이면 None."""
    if not email:
        return None
    cleaned = email.strip().lower()
    return cleaned or None


async def _emails_for_user_ids(db: AsyncSession, user_ids: list[int]) -> list[str]:
    """사용자 id 목록 → 활성 사용자들의 email 목록 (메일 없는 사용자 스킵)."""
    if not user_ids:
        return []
    rows = (
        await db.execute(
            select(User.email).where(
                User.id.in_(user_ids),
                User.is_active.is_(True),
                User.email.is_not(None),
            )
        )
    ).all()
    return [r[0] for r in rows if r[0]]


async def resolve_recipients(db: AsyncSession, mail_schedule_id: int) -> list[str]:
    """스케줄의 수신자 행을 실제 이메일 집합으로 전개한다.

    반환: 소문자 정규화 + 중복 제거된 이메일 리스트(정렬). 발송 대상.
    """
    recipients = (
        await db.execute(
            select(MailRecipient).where(
                MailRecipient.mail_schedule_id == mail_schedule_id
            )
        )
    ).scalars().all()

    collected: set[str] = set()

    for r in recipients:
        rtype = r.recipient_type
        emails: list[str] = []

        if rtype == RecipientType.EMAIL:
            emails = [r.email] if r.email else []

        elif rtype == RecipientType.USER and r.recipient_id is not None:
            emails = await _emails_for_user_ids(db, [r.recipient_id])

        elif rtype == RecipientType.GROUP and r.recipient_id is not None:
            member_ids = (
                await db.execute(
                    select(UserGroupMember.user_id).where(
                        UserGroupMember.group_id == r.recipient_id
                    )
                )
            ).scalars().all()
            emails = await _emails_for_user_ids(db, list(member_ids))

        elif rtype == RecipientType.DEPARTMENT and r.recipient_id is not None:
            dept_user_ids = (
                await db.execute(
                    select(User.id).where(
                        User.department_id == r.recipient_id,
                        User.is_active.is_(True),
                    )
                )
            ).scalars().all()
            emails = await _emails_for_user_ids(db, list(dept_user_ids))

        for e in emails:
            norm = _normalize(e)
            if norm:
                collected.add(norm)

    result = sorted(collected)
    logger.info(
        "recipients_resolved",
        mail_schedule_id=mail_schedule_id,
        recipient_rows=len(recipients),
        resolved_count=len(result),
    )
    return result
