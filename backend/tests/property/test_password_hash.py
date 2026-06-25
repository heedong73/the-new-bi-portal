"""Feature: the-new-bi-portal, Property 11: 비밀번호 SHA-256 3회 해시 검증의 정확성.

For any 비밀번호 p에 대해:
- h(p)는 결정적이다 (같은 입력 → 같은 출력).
- authenticate(p, stored) ⟺ h(p) == stored.
- 출력은 항상 64자 소문자 hex.
"""
from __future__ import annotations

import hashlib

from hypothesis import given, settings, strategies as st

from app.services.auth.password_hash import hash_password, verify_password

def _reference_hash(p: str) -> str:
    h = p
    for _ in range(3):
        h = hashlib.sha256(h.encode("utf-8")).hexdigest()
    return h

@given(p=st.text())
@settings(max_examples=200, deadline=None)
def test_hash_is_deterministic(p: str):
    """결정성: 동일 입력은 항상 동일 출력."""
    assert hash_password(p) == hash_password(p)

@given(p=st.text())
@settings(max_examples=200, deadline=None)
def test_hash_matches_reference(p: str):
    """우리 구현이 SHA-256 3회 hex 재해싱 레퍼런스와 일치."""
    assert hash_password(p) == _reference_hash(p)

@given(p=st.text())
@settings(max_examples=200, deadline=None)
def test_hash_is_64_lower_hex(p: str):
    """출력은 항상 64자 소문자 hex."""
    out = hash_password(p)
    assert len(out) == 64
    assert out == out.lower()
    assert all(c in "0123456789abcdef" for c in out)

@given(p=st.text())
@settings(max_examples=200, deadline=None)
def test_verify_iff_hash_equals_stored(p: str):
    """authenticate ⟺ h(p) == stored: 올바른 해시는 통과, 변형은 실패."""
    stored = hash_password(p)
    assert verify_password(p, stored) is True
    # 한 글자 바꾼 해시는 실패
    wrong = ("0" if stored[0] != "0" else "1") + stored[1:]
    assert verify_password(p, wrong) is False
