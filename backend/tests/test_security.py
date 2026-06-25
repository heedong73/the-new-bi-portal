"""보안 + 캐시 검증 (T-42, R27/R38).

- 로그 secret 마스킹: structlog _mask_secrets 가 시크릿 키 값을 *** 로 치환
- 캐시 hit/miss: cache_set/get_json 왕복 + 미스 None
- 감사/임베드 시크릿 비노출은 PBT(test_audit_secret_masking, test_embed_token_scope)가 커버
"""
from __future__ import annotations

import pytest

from app.core.logging import _mask_secrets, _SECRET_KEYS


def test_log_masks_secret_keys():
    """시크릿 키 값은 로그에서 *** 로 마스킹된다."""
    event = {
        "event": "login",
        "password": "super-secret",
        "access_token": "abc.def",
        "client_secret": "xyz",
        "emp_no": "1001",  # 비시크릿은 보존
    }
    masked = _mask_secrets(None, "info", dict(event))
    assert masked["password"] == "***"
    assert masked["access_token"] == "***"
    assert masked["client_secret"] == "***"
    assert masked["emp_no"] == "1001"  # 일반 값은 유지


def test_secret_keys_cover_critical():
    """핵심 시크릿 키가 마스킹 목록에 포함되어 있다."""
    lowered = {k.lower() for k in _SECRET_KEYS}
    for k in ("password", "token", "client_secret", "session_secret", "smtp_password"):
        assert k in lowered


@pytest.mark.asyncio
async def test_cache_roundtrip_and_miss():
    """캐시 set→get 왕복 일치, 미스는 None (조회 SLA 캐시 경로 동작)."""
    import uuid

    from app.db.redis import redis_client
    from app.services.cache import cache_get_json, cache_set_json

    key = f"bip:test:cache:{uuid.uuid4().hex}"
    try:
        assert await cache_get_json(redis_client, key) is None  # 미스

        payload = {"a": 1, "b": [1, 2, 3], "k": "v"}
        await cache_set_json(redis_client, key, payload, ttl_sec=30)

        got = await cache_get_json(redis_client, key)
        assert got == payload  # 히트 = 동일 값
    finally:
        await redis_client.delete(key)
        await redis_client.aclose()
