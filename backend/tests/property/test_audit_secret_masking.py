"""Feature: the-new-bi-portal, Property 10: 감사 로그 시크릿 미기록.

audit_service._sanitize_meta 는 임의의 meta dict 에 대해:
  - 금지 키(password/token/secret/...)를 절대 통과시키지 않는다.
  - 화이트리스트에 없는 키는 제거한다(= 결과 키는 항상 화이트리스트의 부분집합).
  - 화이트리스트 값은 보존한다.
어떤 입력에서도 시크릿 값이 결과에 남지 않음을 hypothesis 로 검증한다(R35).
"""
from __future__ import annotations

from hypothesis import given, settings as h_settings, strategies as st

from app.services.audit_service import (
    _ALLOWED_META_KEYS,
    _FORBIDDEN_KEYS,
    _sanitize_meta,
)

# 임의의 키(화이트리스트/금지/임의 문자열 혼합) + 임의 값
_keys = st.one_of(
    st.sampled_from(sorted(_ALLOWED_META_KEYS)),
    st.sampled_from(sorted(_FORBIDDEN_KEYS)),
    st.text(min_size=1, max_size=20),
)
_values = st.one_of(
    st.text(max_size=50),
    st.integers(),
    st.booleans(),
    st.none(),
)
_meta = st.dictionaries(keys=_keys, values=_values, max_size=12)


@given(meta=_meta)
@h_settings(max_examples=300)
def test_sanitize_never_leaks_forbidden_keys(meta):
    """금지 키는 결과에 절대 포함되지 않는다."""
    clean = _sanitize_meta(meta)
    if clean is None:
        return
    for key in clean:
        assert key not in _FORBIDDEN_KEYS


@given(meta=_meta)
@h_settings(max_examples=300)
def test_sanitize_only_whitelist_keys(meta):
    """결과 키는 항상 화이트리스트의 부분집합이다."""
    clean = _sanitize_meta(meta)
    if clean is None:
        return
    assert set(clean.keys()).issubset(_ALLOWED_META_KEYS)


@given(
    secret_value=st.text(min_size=1, max_size=40),
    extra=st.dictionaries(
        keys=st.sampled_from(sorted(_ALLOWED_META_KEYS)),
        values=st.text(max_size=20),
        max_size=5,
    ),
)
@h_settings(max_examples=200)
def test_secret_value_absent_from_result(secret_value, extra):
    """금지 키에 담긴 시크릿 값은 결과 어디에도 남지 않는다."""
    meta = dict(extra)
    for forbidden in _FORBIDDEN_KEYS:
        meta[forbidden] = secret_value
    clean = _sanitize_meta(meta) or {}
    # 시크릿 키 자체가 없어야 하고, 화이트리스트 값에 섞여 들어가지도 않음
    assert all(k not in _FORBIDDEN_KEYS for k in clean)
    # secret_value 가 화이트리스트 값과 우연히 같지 않은 한 결과 값에 없어야 한다
    if secret_value not in extra.values():
        assert secret_value not in clean.values()
