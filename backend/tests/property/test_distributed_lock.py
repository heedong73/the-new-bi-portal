"""Feature: the-new-bi-portal, Property 4: 분산 락 상호 배제.

- 동일 키로 N개 동시 acquire → 정확히 1개만 non-None.
- 락 미소유자의 release는 락을 해제하지 못함 (Lua atomic).
PRM lock.py 재활용 검증.
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
import pytest_asyncio
import redis.asyncio as aioredis

from app.core.config import settings
from app.services.powerbi.lock import acquire_lock, release_lock, is_locked

@pytest_asyncio.fixture
async def redis_client():
    client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    yield client
    await client.aclose()

@pytest.mark.asyncio
@pytest.mark.parametrize("n", [2, 5, 10])
async def test_mutual_exclusion(redis_client, n):
    """N개 동시 acquire 중 정확히 1개만 성공."""
    key = uuid.uuid4().hex
    try:
        results = await asyncio.gather(
            *[acquire_lock(redis_client, "test", key) for _ in range(n)]
        )
        non_none = [r for r in results if r is not None]
        assert len(non_none) == 1
    finally:
        # 정리: 획득한 락 해제
        for r in results:
            if r is not None:
                await release_lock(redis_client, "test", key, r)

@pytest.mark.asyncio
async def test_non_owner_cannot_release(redis_client):
    """락 미소유자(틀린 값)는 해제 불가."""
    key = uuid.uuid4().hex
    owner_value = await acquire_lock(redis_client, "test", key)
    assert owner_value is not None
    try:
        # 틀린 값으로 release 시도 → 락 유지돼야 함
        await release_lock(redis_client, "test", key, "wrong-value")
        assert await is_locked(redis_client, "test", key) is True
    finally:
        await release_lock(redis_client, "test", key, owner_value)
    # 올바른 값으로 해제 후엔 사라짐
    assert await is_locked(redis_client, "test", key) is False
