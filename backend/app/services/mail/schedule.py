"""메일 스케줄 주기 → cron 변환 (사용자 친화 입력 → 내부 cron_expr).

사용자는 주기(일/주/월) + 시간(HH:MM) + (주: 요일들 / 월: 일자)를 입력하고,
백엔드가 이를 cron_expr 로 변환해 저장한다. 발화 판정은 기존 croniter 기반
mail_dispatch 가 그대로 사용한다. 기간(start_date/end_date)은 dispatch 에서
별도 게이트로 처리한다.

요일 코드는 cron 표준 숫자(0=일 ~ 6=토)를 사용한다.
"""
from __future__ import annotations

FREQ_DAILY = "daily"
FREQ_WEEKLY = "weekly"
FREQ_MONTHLY = "monthly"
VALID_FREQS = frozenset({FREQ_DAILY, FREQ_WEEKLY, FREQ_MONTHLY})


def build_cron_expr(
    freq: str | None,
    time_hhmm: str | None,
    days: list[int] | None = None,
    day_of_month: int | None = None,
) -> str | None:
    """주기/시간/요일/일자 → cron_expr. 입력이 불완전하면 None.

    - daily:   ``M H * * *``
    - weekly:  ``M H * * D1,D2,...`` (요일 미지정 시 매일 = ``*``)
    - monthly: ``M H DOM * *`` (일자 미지정 시 1일)
    """
    if freq not in VALID_FREQS or not time_hhmm:
        return None
    try:
        hh, mm = time_hhmm.split(":")
        hour, minute = int(hh), int(mm)
    except (ValueError, AttributeError):
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None

    if freq == FREQ_DAILY:
        return f"{minute} {hour} * * *"
    if freq == FREQ_WEEKLY:
        valid_days = sorted({d for d in (days or []) if 0 <= d <= 6})
        dow = ",".join(str(d) for d in valid_days) if valid_days else "*"
        return f"{minute} {hour} * * {dow}"
    if freq == FREQ_MONTHLY:
        dom = day_of_month if (day_of_month and 1 <= day_of_month <= 31) else 1
        return f"{minute} {hour} {dom} * *"
    return None
