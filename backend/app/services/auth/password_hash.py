"""인사정보 DB 레거시 비밀번호 검증용 SHA-256 3회 해시.

보안 주의: 단순 SHA-256 반복은 신규 비밀번호 저장 방식으로 권장되지 않는다.
기존 그룹웨어가 생성한 login_pwd(64자 소문자 hex)를 검증하기 위한 레거시 전용.
BIP는 비밀번호/해시를 저장하지 않으며 입력 비밀번호는 메모리에서만 사용한다.

방식 확정(D-01): 매 라운드 hex 문자열을 UTF-8로 재해싱, 3회 반복.
운영 중인 다른 프로젝트에서 동일 방식으로 검증됨.
"""
from __future__ import annotations

import hashlib

HASH_ROUNDS = 3

def hash_password(plain: str, rounds: int = HASH_ROUNDS) -> str:
    """평문에 SHA-256을 rounds회 반복 적용, 64자 소문자 hex 반환 (결정성, Property 11)."""
    hashed = plain
    for _ in range(rounds):
        hashed = hashlib.sha256(hashed.encode("utf-8")).hexdigest()
    return hashed

def verify_password(plain: str, stored_hash: str) -> bool:
    """입력 비밀번호 해시가 저장된 login_pwd와 일치하는지 (authenticate ⟺ h(p)==stored)."""
    if not stored_hash:
        return False
    return hash_password(plain) == stored_hash.strip().lower()
