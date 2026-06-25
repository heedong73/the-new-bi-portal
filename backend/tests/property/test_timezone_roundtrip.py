"""Feature: the-new-bi-portal, Property 6: UTC↔Local 시간 변환 왕복 (R30).

core/timezone 의 to_utc/to_local 이 동일 절대시각을 보존하는지(왕복 불변),
compute_time_columns 가 UTC 정규값 + Local 파생값을 일관되게 산출하는지 검증한다.
"""
from __future__ import annotations

from datetime import datetime, timezone

from hypothesis import given, settings, strategies as st

from app.core.timezone import compute_time_columns, to_local, to_utc

# 합리적 범위의 naive datetime (tz 없는 UTC 기준으로 취급)
_dt = st.datetimes(
    min_value=datetime(2000, 1, 1),
    max_value=datetime(2100, 1, 1),
)


@given(dt=_dt)
@settings(max_examples=200)
def test_utc_local_roundtrip_preserves_instant(dt):
    """UTC-aware → Local → UTC 왕복 시 동일 절대시각."""
    utc_aware = dt.replace(tzinfo=timezone.utc)
    local = to_local(utc_aware)
    back = to_utc(local)
    assert back == utc_aware  # 동일 instant


@given(dt=_dt)
@settings(max_examples=200)
def test_to_local_is_same_instant(dt):
    """to_local 결과는 입력과 같은 절대시각(표현만 KST)."""
    utc_aware = dt.replace(tzinfo=timezone.utc)
    local = to_local(utc_aware)
    assert local.timestamp() == utc_aware.timestamp()


@given(start=_dt, dur_sec=st.integers(min_value=0, max_value=86_400))
@settings(max_examples=100)
def test_compute_time_columns_consistency(start, dur_sec):
    """compute_time_columns: local = to_local(utc), duration = end-start(>=0)."""
    from datetime import timedelta

    start_utc = start.replace(tzinfo=timezone.utc)
    end_utc = start_utc + timedelta(seconds=dur_sec)
    cols = compute_time_columns(start_utc, end_utc)

    assert cols["start_time_utc"] == start_utc
    assert cols["end_time_utc"] == end_utc
    assert cols["start_time_local"] == to_local(start_utc)
    assert cols["end_time_local"] == to_local(end_utc)
    assert cols["duration_seconds"] == dur_sec
