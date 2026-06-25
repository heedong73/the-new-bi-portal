"""휴일 서비스 영업일 판정 + 시드 테스트.

conftest 의 db fixture(트랜잭션 롤백 격리)를 사용한다. holiday_service 함수는
db 세션을 인자로 받으므로 fixture 세션으로 직접 검증 가능하다.
"""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from app.models.holiday import Holiday
from app.services import holiday_service as hs


def test_is_weekend():
    assert hs.is_weekend(date(2026, 6, 27))  # 토
    assert hs.is_weekend(date(2026, 6, 28))  # 일
    assert not hs.is_weekend(date(2026, 6, 26))  # 금


@pytest.mark.asyncio
async def test_weekend_not_business_day(db):
    # 토요일: skip_weekends=True 면 영업일 아님
    assert not await hs.is_business_day(db, date(2026, 6, 27), skip_weekends=True)
    # skip_weekends=False 면 주말도 영업일로 취급
    assert await hs.is_business_day(db, date(2026, 6, 27), skip_weekends=False)


@pytest.mark.asyncio
async def test_holiday_excluded(db):
    d = date(2026, 5, 5)  # 임의 평일(화) — 사내 공휴일로 등록
    db.add(Holiday(holiday_date=d, name="사내 창립기념일", holiday_type="company"))
    await db.flush()
    # 평일이지만 공휴일 → 영업일 아님
    assert await hs.is_business_day(db, d, skip_weekends=True, skip_holidays=True) is False
    # skip_holidays=False 면 공휴일 무시 → 영업일
    assert await hs.is_business_day(db, d, skip_weekends=True, skip_holidays=False)


@pytest.mark.asyncio
async def test_recurring_holiday_matches_month_day(db):
    # 매년 반복(2025년 등록) → 다른 연도 같은 월/일도 휴일
    db.add(Holiday(holiday_date=date(2025, 7, 17), name="제헌절(사내)",
                   holiday_type="company", is_recurring=True))
    await db.flush()
    assert await hs.is_holiday(db, date(2030, 7, 17))  # 연도 달라도 매칭
    assert not await hs.is_holiday(db, date(2030, 7, 18))


@pytest.mark.asyncio
async def test_seed_korean_holidays(db):
    added = await hs.seed_korean_holidays(db, 2026)
    assert added > 0
    # 신정(1/1)이 시드됨
    jan1 = await db.scalar(select(Holiday).where(Holiday.holiday_date == date(2026, 1, 1)))
    assert jan1 is not None
    # 재시드 시 중복 추가 없음(기존 보존)
    again = await hs.seed_korean_holidays(db, 2026)
    assert again == 0
