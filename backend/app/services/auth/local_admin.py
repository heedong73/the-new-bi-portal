"""Local_Admin — 비상 로컬 관리자 인증 (인사 DB와 독립).

design.md "비상 로컬 관리자"(D-11) 참조. argon2id로 해시된 자격 증명을 검증한다.
인사 DB 장애 시에도 운영 접근을 유지(R2, R33.2). 반복 실패 시 Redis 기반 lockout(R39.4).
"""
from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import LocalAdmin

_ph = PasswordHasher()

# 로그인 실패 제한 정책
_FAIL_PREFIX = "bip:local_admin_fail:"
_MAX_FAILS = 5
_LOCKOUT_SECONDS = 300

def hash_secret(plain: str) -> str:
    """argon2id 해시 생성 (로컬 관리자 비밀번호 저장용)."""
    return _ph.hash(plain)

def _fail_key(username: str) -> str:
    return f"{_FAIL_PREFIX}{username}"

async def is_locked(redis: Redis, username: str) -> bool:
    """반복 실패로 잠긴 상태인지."""
    count = await redis.get(_fail_key(username))
    return count is not None and int(count) >= _MAX_FAILS

async def _record_fail(redis: Redis, username: str) -> None:
    key = _fail_key(username)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, _LOCKOUT_SECONDS)

async def _clear_fails(redis: Redis, username: str) -> None:
    await redis.delete(_fail_key(username))

async def authenticate_local_admin(
    db: AsyncSession, redis: Redis, username: str, password: str
) -> LocalAdmin | None:
    """로컬 관리자 인증. 성공 시 LocalAdmin, 실패/잠금 시 None.

    잠금 상태면 검증 없이 None. 성공 시 실패 카운터 초기화.
    """
    if await is_locked(redis, username):
        return None

    admin = await db.scalar(
        select(LocalAdmin).where(
            LocalAdmin.username == username, LocalAdmin.is_active == True  # noqa: E712
        )
    )
    if admin is None:
        await _record_fail(redis, username)
        return None

    try:
        _ph.verify(admin.password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        await _record_fail(redis, username)
        return None

    await _clear_fails(redis, username)
    return admin
