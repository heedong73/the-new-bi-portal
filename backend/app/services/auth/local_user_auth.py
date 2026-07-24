"""로컬 사용자 인증 — bip.users 중 is_local=True 계정 argon2 검증 + 실패 제한.

그룹웨어(HR) 인사 정보가 없는 계정을 관리자가 직접 만들고 로그인할 수 있게 한다
(테스트/외부 인력용). LocalAdmin(비상 운영자 전용)과 다르다: 이쪽은 일반 User
테이블을 그대로 쓰기 때문에 역할/그룹/레포트 권한 모델을 그대로 재사용한다.
"""
from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import User

_ph = PasswordHasher()

_FAIL_PREFIX = "bip:local_user_fail:"
_MAX_FAILS = 5
_LOCKOUT_SECONDS = 300


def hash_password(plain: str) -> str:
    """로컬 사용자 비밀번호 argon2id 해시 생성."""
    return _ph.hash(plain)


def _fail_key(login_id: str) -> str:
    return f"{_FAIL_PREFIX}{login_id}"


async def is_locked(redis: Redis, login_id: str) -> bool:
    count = await redis.get(_fail_key(login_id))
    return count is not None and int(count) >= _MAX_FAILS


async def _record_fail(redis: Redis, login_id: str) -> None:
    key = _fail_key(login_id)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, _LOCKOUT_SECONDS)


async def _clear_fails(redis: Redis, login_id: str) -> None:
    await redis.delete(_fail_key(login_id))


async def authenticate_local_user(
    db: AsyncSession, redis: Redis, login_id: str, password: str
) -> User | None:
    """로컬 사용자 인증. 성공 시 User, 실패/잠금 시 None.

    login_id는 users.external_id에 저장한 자유 문자열. is_local=True and is_active=True
    조건에서만 매치한다(HR 사용자와 external_id가 우연히 겹쳐도 로컬 인증에 잡히지 않음).
    """
    if await is_locked(redis, login_id):
        return None

    user = await db.scalar(
        select(User).where(
            User.external_id == login_id,
            User.is_local == True,  # noqa: E712
            User.is_active == True,  # noqa: E712
        )
    )
    if user is None or not user.password_hash:
        await _record_fail(redis, login_id)
        return None

    try:
        _ph.verify(user.password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        await _record_fail(redis, login_id)
        return None

    await _clear_fails(redis, login_id)
    return user


async def find_local_user(db: AsyncSession, login_id: str) -> User | None:
    """로컬 계정 존재 여부만 확인(비밀번호 검증 없이). 로그인 라우트가 HR vs 로컬을 분기할 때 사용."""
    return await db.scalar(
        select(User).where(User.external_id == login_id, User.is_local == True)  # noqa: E712
    )
