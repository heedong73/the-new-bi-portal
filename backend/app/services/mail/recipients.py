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

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import RecipientType
from app.core.logging import get_logger
from app.models.auth import User
from app.models.mail import MailRecipient
from app.models.portal import UserGroupMember

logger = get_logger(__name__)


@dataclass
class ResolvedRecipients:
    """전개된 수신자 이메일 — 받는사람(to)/참조(cc)/숨은참조(bcc)로 그룹.

    - to/cc/bcc 는 각각 소문자 정규화 + 정렬된 이메일 리스트.
    - 우선순위(to > cc > bcc)로 전역 중복 제거: 같은 주소가 여러 칸에 걸리면
      가장 높은 칸에만 남는다(중복 발송 방지).
    """

    to: list[str] = field(default_factory=list)
    cc: list[str] = field(default_factory=list)
    bcc: list[str] = field(default_factory=list)

    @property
    def envelope(self) -> list[str]:
        """실제 SMTP 발송 대상(to+cc+bcc). bcc 포함, 중복 없음."""
        return [*self.to, *self.cc, *self.bcc]

    @property
    def total(self) -> int:
        return len(self.to) + len(self.cc) + len(self.bcc)


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


async def resolve_recipients(
    db: AsyncSession, mail_schedule_id: int
) -> ResolvedRecipients:
    """스케줄의 수신자 행을 실제 이메일 집합으로 전개한다.

    각 수신자 행의 field(to/cc/bcc)에 따라 그룹으로 분류하고, 소문자 정규화 +
    우선순위(to > cc > bcc) 중복 제거 후 반환한다.
    """
    recipients = (
        await db.execute(
            select(MailRecipient).where(
                MailRecipient.mail_schedule_id == mail_schedule_id
            )
        )
    ).scalars().all()

    buckets: dict[str, set[str]] = {"to": set(), "cc": set(), "bcc": set()}

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

        target = r.field if r.field in buckets else "to"
        for e in emails:
            norm = _normalize(e)
            if norm:
                buckets[target].add(norm)

    # 우선순위 중복 제거: to > cc > bcc
    to_set = buckets["to"]
    cc_set = buckets["cc"] - to_set
    bcc_set = buckets["bcc"] - to_set - cc_set

    resolved = ResolvedRecipients(
        to=sorted(to_set),
        cc=sorted(cc_set),
        bcc=sorted(bcc_set),
    )
    logger.info(
        "recipients_resolved",
        mail_schedule_id=mail_schedule_id,
        recipient_rows=len(recipients),
        to_count=len(resolved.to),
        cc_count=len(resolved.cc),
        bcc_count=len(resolved.bcc),
    )
    return resolved
