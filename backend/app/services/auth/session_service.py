"""Session_Service — Redis 기반 세션 생성/검증/무효화.

design.md "세션 설계"(D-02) 참조. 쿠키 세션 토큰 + Redis 저장 방식.
- 세션 데이터: bip:session:{session_id} (TTL = SESSION_TTL_MINUTES)
- 사용자별 세션 추적: bip:user_sessions:{user_id} (Set) → 비활성화 시 즉시 전체 무효화(R4.3)
세션은 휘발성: 손실 시 재로그인으로 복구(R29.4).
"""
from __future__ import annotations

import json
import secrets

from redis.asyncio import Redis

from app.core.config import settings

_SESSION_PREFIX = "bip:session:"
_USER_SESSIONS_PREFIX = "bip:user_sessions:"

def _session_key(session_id: str) -> str:
    return f"{_SESSION_PREFIX}{session_id}"

def _user_sessions_key(user_id: int) -> str:
    return f"{_USER_SESSIONS_PREFIX}{user_id}"

async def create_session(redis: Redis, user_id: int, data: dict) -> str:
    """새 세션 생성. session_id 반환. 사용자별 Set에도 등록.

    data에는 emp_no/name/roles 등 요약 정보를 담는다(시크릿 금지).
    """
    session_id = secrets.token_urlsafe(32)
    ttl_seconds = settings.SESSION_TTL_MINUTES * 60

    payload = {"user_id": user_id, **data}
    await redis.set(_session_key(session_id), json.dumps(payload), ex=ttl_seconds)

    # 사용자별 세션 추적 Set (즉시 무효화용). Set 자체에도 TTL 부여(세션보다 약간 길게).
    uskey = _user_sessions_key(user_id)
    await redis.sadd(uskey, session_id)
    await redis.expire(uskey, ttl_seconds + 60)

    return session_id

async def get_session(redis: Redis, session_id: str) -> dict | None:
    """세션 조회. 없거나 만료면 None."""
    if not session_id:
        return None
    raw = await redis.get(_session_key(session_id))
    if raw is None:
        return None
    return json.loads(raw)

async def destroy_session(redis: Redis, session_id: str) -> None:
    """단일 세션 무효화(로그아웃). 사용자별 Set에서도 제거."""
    raw = await redis.get(_session_key(session_id))
    await redis.delete(_session_key(session_id))
    if raw:
        user_id = json.loads(raw).get("user_id")
        if user_id is not None:
            await redis.srem(_user_sessions_key(user_id), session_id)

async def destroy_user_sessions(redis: Redis, user_id: int) -> int:
    """사용자의 모든 활성 세션 즉시 무효화(R4.3 비활성화). 삭제 개수 반환."""
    uskey = _user_sessions_key(user_id)
    session_ids = await redis.smembers(uskey)
    count = 0
    for sid in session_ids:
        await redis.delete(_session_key(sid))
        count += 1
    await redis.delete(uskey)
    return count
