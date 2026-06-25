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

    공휴일 이름은 한국어(language="ko")로 저장하며, 대체공휴일(name에 '대체' 포함)은
    holiday_type='substitute'로 분류한다. 이미 등록된 날짜라도 자동 시드 항목
    (national/substitute)이면 한글명/구분을 갱신하여 영어명 등 과거 데이터를 보정한다.
    사내 공휴일(company)은 보존한다. 신규 추가 + 갱신 건수를 합산해 반환한다.
    """
    kr = holidays_lib.country_holidays("KR", years=year, language="ko")
    existing = {
        h.holiday_date: h
        for h in (await db.execute(select(Holiday))).scalars().all()
    }
    changed = 0
    for hday, name in sorted(kr.items()):
        htype = "substitute" if "대체" in name else "national"
        cur = existing.get(hday)
        if cur is None:
            db.add(Holiday(holiday_date=hday, name=name, holiday_type=htype, is_recurring=False))
            changed += 1
        elif cur.holiday_type in ("national", "substitute"):
            # 자동 시드 항목이면 한글명/구분 갱신 (사내 공휴일은 보존)
            if cur.name != name or cur.holiday_type != htype:
                cur.name = name
                cur.holiday_type = htype
                changed += 1
    await db.flush()
    logger.info("holidays_seeded", year=year, changed=changed)
    return changed
