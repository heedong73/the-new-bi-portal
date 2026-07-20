"""MockPowerBIClient의 상태 있는 모의 refresh(트리거→진행→취소) 단위 테스트.

semantic review에서 지적된 문제의 회귀 테스트: mock 모드(기본 실행 모드)에서는 기존에
list_refreshes가 매 호출 새로 생성되는 고정 분포 fixture만 반환해 실제 트리거와 무관했고,
cancel_refresh는 아무 것도 하지 않고 성공만 반환했다. 이래서는 중지 버튼이 활성화되지
않거나(ViaEnhancedApi 활성 run이 없음), 취소가 성공해도 후속 폴링이 Cancelled를 관측할 수
없었다. register_mock_refresh로 Redis에 단일 진행 refresh를 등록하면 list_refreshes가 이를
반영하고, cancel_refresh가 실제로 Cancelled로 전이시켜야 한다.
"""
from __future__ import annotations

import json

import pytest

from app.core.errors import PowerBIUpstreamError
from app.services.powerbi.mock_client import MockPowerBIClient, register_mock_refresh

_DATASET_ID = "ds-sales-0001"
_WORKSPACE_ID = "ws-1"


class FakeRedis:
    """단일 dict 기반 in-memory fake — 실제 Redis 클라이언트의 get/set/delete와 호환."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        self.store[key] = value
        return True

    async def delete(self, *keys: str) -> None:
        for key in keys:
            self.store.pop(key, None)


@pytest.mark.asyncio
async def test_list_refreshes_reflects_registered_mock_refresh_as_in_progress():
    """등록된 refresh는 list_refreshes 최상단에 Unknown/ViaEnhancedApi로 나타난다."""
    redis = FakeRedis()
    await register_mock_refresh(redis, _DATASET_ID, "mock-req-1")
    client = MockPowerBIClient(redis=redis)

    runs = await client.list_refreshes(_WORKSPACE_ID, _DATASET_ID, top=5)

    assert runs[0].request_id == "mock-req-1"
    assert runs[0].status == "Unknown"
    assert runs[0].refresh_type == "ViaEnhancedApi"
    assert runs[0].end_time is None


@pytest.mark.asyncio
async def test_cancel_refresh_transitions_registered_refresh_to_cancelled():
    """cancel_refresh 호출 후 list_refreshes는 해당 항목을 Cancelled로 반환해야 한다.

    이래야 프론트의 폴링(Unknown -> Cancelled 확인)이 mock 모드에서도 실제로 종료된다.
    """
    redis = FakeRedis()
    await register_mock_refresh(redis, _DATASET_ID, "mock-req-2")
    client = MockPowerBIClient(redis=redis)

    await client.cancel_refresh(_WORKSPACE_ID, _DATASET_ID, "mock-req-2")
    runs = await client.list_refreshes(_WORKSPACE_ID, _DATASET_ID, top=5)

    cancelled = next(r for r in runs if r.request_id == "mock-req-2")
    assert cancelled.status == "Cancelled"
    assert cancelled.end_time is not None


@pytest.mark.asyncio
async def test_cancel_refresh_rejects_mismatched_refresh_id():
    """등록된 것과 다른 refresh_id로 취소를 시도하면 실제 Power BI의 400을 재현한다."""
    redis = FakeRedis()
    await register_mock_refresh(redis, _DATASET_ID, "mock-req-3")
    client = MockPowerBIClient(redis=redis)

    with pytest.raises(PowerBIUpstreamError) as exc_info:
        await client.cancel_refresh(_WORKSPACE_ID, _DATASET_ID, "some-other-id")

    assert exc_info.value.details.get("http_status") == 400


@pytest.mark.asyncio
async def test_cancel_refresh_rejects_already_terminal_refresh():
    """이미 취소된 refresh를 다시 취소하면 400을 재현한다(실제 취소 실패 경로와 동일)."""
    redis = FakeRedis()
    await register_mock_refresh(redis, _DATASET_ID, "mock-req-4")
    client = MockPowerBIClient(redis=redis)
    await client.cancel_refresh(_WORKSPACE_ID, _DATASET_ID, "mock-req-4")

    with pytest.raises(PowerBIUpstreamError) as exc_info:
        await client.cancel_refresh(_WORKSPACE_ID, _DATASET_ID, "mock-req-4")

    assert exc_info.value.details.get("http_status") == 400


@pytest.mark.asyncio
async def test_list_refreshes_without_redis_falls_back_to_stateless_fixtures():
    """redis=None(하위호환)이면 등록 없이 기존처럼 생성형 fixture만 반환한다."""
    client = MockPowerBIClient()

    runs = await client.list_refreshes(_WORKSPACE_ID, _DATASET_ID, top=5)

    assert len(runs) == 5
    assert all(r.request_id.startswith("req-") for r in runs)


@pytest.mark.asyncio
async def test_register_mock_refresh_persists_json_record_with_ttl():
    """register_mock_refresh는 Unknown 상태의 JSON 레코드를 TTL과 함께 저장한다."""
    redis = FakeRedis()

    await register_mock_refresh(redis, _DATASET_ID, "mock-req-5")

    raw = redis.store[f"bip:mockrefresh:{_DATASET_ID}"]
    record = json.loads(raw)
    assert record["request_id"] == "mock-req-5"
    assert record["status"] == "Unknown"
    assert record["end_time"] is None
