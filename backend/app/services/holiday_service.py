"""휴일 서비스 — 영업일 판정 + 국가 공휴일 시드.

메일 스케줄 발송 제외(주말/공휴일) 판정에 사용한다. 모든 날짜 판정은 KST
(APP_TIMEZONE) 기준이며, holidays 라이브러리로 국가 공휴일/대체공휴일을 시드하고
사내 공휴일은 관리자가 직접 입력한다.
"""
from __future__ import annotations

from datetime import date, datetime

import holidays as holidays_lib
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.timezone import get_app_tz
from app.models.holiday import Holiday

logger = get_logger(__name__)


def today_kst() -> date:
    """현재 KST 날짜."""
    return datetime.now(tz=get_app_tz()).date()


def is_weekend(d: date) -> bool:
    """토(5)/일(6) 여부."""
    return d.weekday() >= 5


async def is_holiday(db: AsyncSession, d: date) -> bool:
    """해당 날짜가 휴일 테이블에 있는지(고정일 + 매년 반복일 매칭)."""
    # 정확한 날짜 매칭
    exact = await db.scalar(select(Holiday.id).where(Holiday.holiday_date == d))
    if exact is not None:
        return True
    # 매년 반복(is_recurring): 월/일이 일치하면 휴일
    recurring = (
        await db.execute(select(Holiday.holiday_date).where(Holiday.is_recurring.is_(True)))
    ).scalars().all()
    return any(h.month == d.month and h.day == d.day for h in recurring)


async def is_business_day(
    db: AsyncSession,
    d: date,
    *,
    skip_weekends: bool = True,
    skip_holidays: bool = True,
) -> bool:
    """발송 가능한 영업일인지 판정.

    skip_weekends=True 면 주말 제외, skip_holidays=True 면 휴일 테이블 제외.
    둘 다 False 면 항상 영업일(=항상 발송).
    """
    if skip_weekends and is_weekend(d):
        return False
    if skip_holidays and await is_holiday(db, d):
        return False
    return True


async def seed_korean_holidays(db: AsyncSession, year: int) -> int:
    """holidays 라이브러리로 해당 연도 KR 국가/대체 공휴일을 시드한다.

    이미 존재하는 날짜는 건너뛴다(관리자 보정 보존). 추가한 건수를 반환한다.
    대체공휴일(name에 'Alternative' 포함)은 holiday_type='substitute'로 저장.
    """
    kr = holidays_lib.country_holidays("KR", years=year)
    existing = set(
        (await db.execute(select(Holiday.holiday_date))).scalars().all()
    )
    added = 0
    for hday, name in sorted(kr.items()):
        if hday in existing:
            continue
        htype = "substitute" if "Alternative" in name else "national"
        db.add(Holiday(holiday_date=hday, name=name, holiday_type=htype, is_recurring=False))
        added += 1
    await db.flush()
    logger.info("holidays_seeded", year=year, added=added)
    return added
