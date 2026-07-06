"""Session_Service — Redis 기반 세션 생성/검증/무효화.

design.md "세션 설계"(D-02) 참조. 쿠키 세션 토큰 + Redis 저장 방식.
- 세션 데이터: bip:session:{session_id}
  - idle(슬라이딩): Redis 키 TTL = SESSION_IDLE_MINUTES. 접근할 때마다 갱신되어
    "마지막 활동 기준" 무활동 시 만료된다.
  - absolute(상한): payload.absolute_exp(로그인+SESSION_ABSOLUTE_MINUTES) 초과 시
    무활동이 아니어도 만료. idle 갱신 TTL 은 absolute 를 넘지 않게 캡한다.
- 사용자별 세션 추적: bip:user_sessions:{user_id} (Set) → 비활성화 시 즉시 전체 무효화(R4.3)
세션은 휘발성: 손실 시 재로그인으로 복구(R29.4).
"""
from __future__ import annotations

import json
import secrets
import time

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
    now = int(time.time())
    idle_seconds = settings.SESSION_IDLE_MINUTES * 60
    absolute_seconds = settings.SESSION_ABSOLUTE_MINUTES * 60
    absolute_exp = now + absolute_seconds

    # absolute_exp(로그인 상한, epoch)를 payload에 담아 매 접근 시 검사한다.
    payload = {"user_id": user_id, "absolute_exp": absolute_exp, **data}
    # 최초 TTL = idle 창(단, absolute 상한을 넘지 않게 캡).
    ttl_seconds = min(idle_seconds, absolute_seconds)
    await redis.set(_session_key(session_id), json.dumps(payload), ex=ttl_seconds)

    # 사용자별 세션 추적 Set (즉시 무효화용). Set TTL은 absolute 상한보다 약간 길게.
    uskey = _user_sessions_key(user_id)
    await redis.sadd(uskey, session_id)
    await redis.expire(uskey, absolute_seconds + 60)

    return session_id

async def get_session(redis: Redis, session_id: str) -> dict | None:
    """세션 조회 + idle 슬라이딩 갱신. 없거나(만료 포함) absolute 초과면 None.

    - absolute 상한(payload.absolute_exp) 초과 → 즉시 폐기 후 None.
    - 유효하면 Redis 키 TTL을 idle 창으로 재설정(단 absolute 를 넘지 않게 캡)하여
      "마지막 활동 기준" 만료가 되게 한다.
    """
    if not session_id:
        return None
    key = _session_key(session_id)
    raw = await redis.get(key)
    if raw is None:
        return None
    payload = json.loads(raw)

    now = int(time.time())
    absolute_exp = payload.get("absolute_exp")
    if absolute_exp is not None and now >= absolute_exp:
        # 로그인 상한 도달 → 무활동이 아니어도 만료(즉시 폐기).
        await destroy_session(redis, session_id)
        return None

    idle_seconds = settings.SESSION_IDLE_MINUTES * 60
    new_ttl = idle_seconds if absolute_exp is None else min(idle_seconds, absolute_exp - now)
    if new_ttl <= 0:
        await destroy_session(redis, session_id)
        return None
    # idle 슬라이딩: 접근 시 TTL 갱신(마지막 활동 기준).
    await redis.expire(key, new_ttl)
    return payload

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
