"""수동 enhanced refresh 트리거와 취소 API 단위 테스트."""
from __future__ import annotations

import importlib
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.api.routes import datasets as datasets_route
from app.core.errors import ConflictError
from app.services.powerbi.client import RefreshRunDTO


class FakeRedis:
    """단일 requestId 키를 흉내내는 단순 fake. ``ttl_value``는 초 단위 남은 TTL로,
    그레이스 구간(``tracking_is_recent``) 판정을 테스트별로 제어하는 데 쓴다.
    """

    def __init__(self, stored_refresh_id: str | None = None, ttl_value: int = 999_999) -> None:
        self.stored_refresh_id = stored_refresh_id
        self.ttl_value = ttl_value
        self.set_calls: list[tuple[tuple, dict]] = []
        self.delete = AsyncMock()

    async def get(self, _key: str) -> str | None:
        return self.stored_refresh_id

    async def ttl(self, _key: str) -> int:
        return self.ttl_value

    async def set(self, *args, **kwargs):
        self.set_calls.append((args, kwargs))
        return True

    async def aclose(self) -> None:
        return None


class KeyedFakeRedis:
    """키별로 값을 구분해야 하는 테스트(락 소유권 등)를 위한 dict 기반 fake."""

    def __init__(self, values: dict[str, str] | None = None) -> None:
        self.values: dict[str, str] = dict(values or {})
        self.set_calls: list[tuple[tuple, dict]] = []

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def set(self, key: str, value: str, **kwargs):
        self.values[key] = value
        self.set_calls.append(((key, value), kwargs))
        return True

    async def delete(self, *keys: str) -> None:
        for key in keys:
            self.values.pop(key, None)

    async def aclose(self) -> None:
        return None


class FakeDb:
    def __init__(self, report) -> None:
        self.report = report
        self.commit = AsyncMock()

    async def scalar(self, _statement):
        return self.report


def running_refresh(refresh_type: str, request_id: str = "refresh-123") -> RefreshRunDTO:
    return RefreshRunDTO(
        dataset_id="dataset-1",
        refresh_type=refresh_type,
        status="Unknown",
        start_time=datetime.now(timezone.utc),
        end_time=None,
        request_id=request_id,
    )


def terminal_refresh(
    refresh_type: str, request_id: str, status: str = "Completed"
) -> RefreshRunDTO:
    now = datetime.now(timezone.utc)
    return RefreshRunDTO(
        dataset_id="dataset-1",
        refresh_type=refresh_type,
        status=status,
        start_time=now,
        end_time=now,
        request_id=request_id,
    )


@pytest.mark.asyncio
async def test_cancel_refresh_uses_running_enhanced_request(monkeypatch):
    report = SimpleNamespace(id=7, workspace_id="workspace-1", dataset_id="dataset-1")
    db = FakeDb(report)
    redis = FakeRedis(stored_refresh_id="refresh-123")
    client = SimpleNamespace(
        list_refreshes=AsyncMock(return_value=[running_refresh("ViaEnhancedApi")]),
        cancel_refresh=AsyncMock(),
    )
    audit = AsyncMock()
    monkeypatch.setattr(
        datasets_route.permission_service,
        "has_permission",
        AsyncMock(return_value=True),
    )
    monkeypatch.setattr(datasets_route, "append_audit", audit)

    result = await datasets_route.cancel_refresh(
        "dataset-1",
        db,
        redis,
        client,
        {"user_id": 1, "emp_no": "1001", "roles": ["General_User"]},
    )

    assert result == {
        "status": "cancellation_requested",
        "dataset_id": "dataset-1",
        "refresh_id": "refresh-123",
    }
    client.cancel_refresh.assert_awaited_once_with(
        "workspace-1", "dataset-1", "refresh-123"
    )
    assert redis.delete.await_count == 1
    audit.assert_awaited_once()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_cancel_refresh_rejects_already_terminal_stored_id(monkeypatch):
    """Redis에 남은 requestId가 이력에서 이미 Completed로 나타나면 재취소하지 않는다.

    semantic review에서 지적된 stale-ID 버그의 회귀 테스트: 이전에는 stored_refresh_id와
    이력 항목이 일치하면 상태를 확인하지 않고 무조건 선택했다. 이제는 활성 목록에 없는
    (=이미 종료된) 일치 항목은 matching_run에서 제외되어야 한다.
    """
    report = SimpleNamespace(id=7, workspace_id="workspace-1", dataset_id="dataset-1")
    db = FakeDb(report)
    redis = FakeRedis(stored_refresh_id="refresh-123")
    client = SimpleNamespace(
        list_refreshes=AsyncMock(
            return_value=[terminal_refresh("ViaEnhancedApi", "refresh-123", status="Completed")]
        ),
        cancel_refresh=AsyncMock(),
    )
    monkeypatch.setattr(
        datasets_route.permission_service,
        "has_permission",
        AsyncMock(return_value=True),
    )

    with pytest.raises(ConflictError, match="중지할 진행 중인 새로고침이 없습니다"):
        await datasets_route.cancel_refresh(
            "dataset-1",
            db,
            redis,
            client,
            {"user_id": 1, "emp_no": "1001", "roles": ["General_User"]},
        )

    client.cancel_refresh.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancel_refresh_ignores_stale_id_outside_grace_period(monkeypatch):
    """그레이스 구간을 벗어난(TTL이 많이 남아 오래된) stored ID는 이력에 없으면 신뢰하지 않는다.

    Power BI 이력에 해당 항목이 전혀 없고(제거/필터 등) 활성 refresh도 없으면, 오래된
    캐시 값으로 DELETE를 재시도하는 대신 "취소할 대상 없음" 409를 반환해야 한다.
    """
    report = SimpleNamespace(id=7, workspace_id="workspace-1", dataset_id="dataset-1")
    db = FakeDb(report)
    # TTL이 만료 임계치(REFRESH_HISTORY_GRACE_SEC)보다 훨씬 적게 남아 "오래된" 것으로 간주.
    redis = FakeRedis(stored_refresh_id="refresh-999", ttl_value=10)
    client = SimpleNamespace(
        list_refreshes=AsyncMock(return_value=[]),
        cancel_refresh=AsyncMock(),
    )
    monkeypatch.setattr(
        datasets_route.permission_service,
        "has_permission",
        AsyncMock(return_value=True),
    )

    with pytest.raises(ConflictError, match="중지할 진행 중인 새로고침이 없습니다"):
        await datasets_route.cancel_refresh(
            "dataset-1",
            db,
            redis,
            client,
            {"user_id": 1, "emp_no": "1001", "roles": ["General_User"]},
        )

    client.cancel_refresh.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancel_refresh_rejects_standard_refresh(monkeypatch):
    report = SimpleNamespace(id=7, workspace_id="workspace-1", dataset_id="dataset-1")
    db = FakeDb(report)
    redis = FakeRedis()
    client = SimpleNamespace(
        list_refreshes=AsyncMock(return_value=[running_refresh("ViaApi")]),
        cancel_refresh=AsyncMock(),
    )
    monkeypatch.setattr(
        datasets_route.permission_service,
        "has_permission",
        AsyncMock(return_value=True),
    )

    with pytest.raises(ConflictError, match="중지할 수 없는 방식"):
        await datasets_route.cancel_refresh(
            "dataset-1",
            db,
            redis,
            client,
            {"user_id": 1, "emp_no": "1001", "roles": ["General_User"]},
        )

    client.cancel_refresh.assert_not_awaited()


class FakeDelayTask:
    def __init__(self, task_id: str = "celery-task-1") -> None:
        self.id = task_id


class FakeRefreshTrigger:
    """``refresh_trigger.delay(...)`` 호출을 기록하는 fake celery task."""

    def __init__(self) -> None:
        self.delay_calls: list[dict] = []

    def delay(self, **kwargs):
        self.delay_calls.append(kwargs)
        return FakeDelayTask()


@pytest.mark.asyncio
async def test_trigger_refresh_blocks_when_active_run_exists_in_live_mode(monkeypatch):
    """Live 모드에서는 refresh_type과 무관하게 활성 run이 있으면 트리거를 막는다.

    semantic review에서 지적된 회귀: 두 번째 트리거 요청이 기존 실행에 잘못 연결되는
    문제의 방어선 — 진행 중인 작업이 있으면 아예 enqueue하지 않는다.
    """
    report = SimpleNamespace(id=7, workspace_id="workspace-1", dataset_id="dataset-1")
    db = FakeDb(report)
    redis = FakeRedis()
    client = SimpleNamespace(
        list_refreshes=AsyncMock(return_value=[running_refresh("Scheduled")]),
    )
    fake_task = FakeRefreshTrigger()
    monkeypatch.setattr(datasets_route.settings, "APP_MODE", "live")
    monkeypatch.setattr(
        datasets_route.permission_service, "has_permission", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(datasets_route, "acquire_lock", AsyncMock(return_value="lock-token"))
    release_lock = AsyncMock()
    monkeypatch.setattr(datasets_route, "release_lock", release_lock)
    monkeypatch.setattr(datasets_route, "refresh_trigger", fake_task)

    with pytest.raises(ConflictError, match="이미 새로고침이 진행 중입니다"):
        await datasets_route.trigger_refresh(
            "dataset-1",
            db,
            redis,
            client,
            {"user_id": 1, "emp_no": "1001", "roles": ["General_User"]},
        )

    assert fake_task.delay_calls == []
    # 워커로 소유권이 넘어가지 못했으므로 API가 예약 락을 해제해야 한다.
    release_lock.assert_awaited_once_with(redis, "refresh", "dataset-1", "lock-token")


@pytest.mark.asyncio
async def test_trigger_refresh_ignores_non_enhanced_fixture_noise_in_mock_mode(monkeypatch):
    """Mock 모드에서는 fixture의 임의 Scheduled/OnDemand Unknown 행이 트리거를 막지 않는다.

    mock 이력은 매 호출 생성되는 flavour-text이며 실제 포털 요청과 무관하므로, 우리가
    추적하는 ViaEnhancedApi 타입만 중복 판정에 반영해야 한다.
    """
    report = SimpleNamespace(id=7, workspace_id="workspace-1", dataset_id="dataset-1")
    db = FakeDb(report)
    redis = FakeRedis(stored_refresh_id=None)
    client = SimpleNamespace(
        list_refreshes=AsyncMock(
            return_value=[running_refresh("Scheduled"), running_refresh("OnDemand")]
        ),
    )
    fake_task = FakeRefreshTrigger()
    audit = AsyncMock()
    monkeypatch.setattr(datasets_route.settings, "APP_MODE", "mock")
    monkeypatch.setattr(
        datasets_route.permission_service, "has_permission", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(datasets_route, "acquire_lock", AsyncMock(return_value="lock-token"))
    monkeypatch.setattr(datasets_route, "release_lock", AsyncMock())
    monkeypatch.setattr(datasets_route, "refresh_trigger", fake_task)
    monkeypatch.setattr(datasets_route, "append_audit", audit)

    result = await datasets_route.trigger_refresh(
        "dataset-1",
        db,
        redis,
        client,
        {"user_id": 1, "emp_no": "1001", "roles": ["General_User"]},
    )

    assert result["status"] == "enqueued"
    assert len(fake_task.delay_calls) == 1
    assert fake_task.delay_calls[0]["lock_value"] == "lock-token"


@pytest.mark.asyncio
async def test_trigger_refresh_blocks_when_enhanced_run_active_in_mock_mode(monkeypatch):
    """Mock 모드라도 우리가 추적하는 ViaEnhancedApi 활성 run이 있으면 막는다."""
    report = SimpleNamespace(id=7, workspace_id="workspace-1", dataset_id="dataset-1")
    db = FakeDb(report)
    redis = FakeRedis(stored_refresh_id=None)
    client = SimpleNamespace(
        list_refreshes=AsyncMock(return_value=[running_refresh("ViaEnhancedApi")]),
    )
    fake_task = FakeRefreshTrigger()
    monkeypatch.setattr(datasets_route.settings, "APP_MODE", "mock")
    monkeypatch.setattr(
        datasets_route.permission_service, "has_permission", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(datasets_route, "acquire_lock", AsyncMock(return_value="lock-token"))
    release_lock = AsyncMock()
    monkeypatch.setattr(datasets_route, "release_lock", release_lock)
    monkeypatch.setattr(datasets_route, "refresh_trigger", fake_task)

    with pytest.raises(ConflictError, match="이미 새로고침이 진행 중입니다"):
        await datasets_route.trigger_refresh(
            "dataset-1",
            db,
            redis,
            client,
            {"user_id": 1, "emp_no": "1001", "roles": ["General_User"]},
        )

    assert fake_task.delay_calls == []
    release_lock.assert_awaited_once_with(redis, "refresh", "dataset-1", "lock-token")


@pytest.mark.asyncio
async def test_trigger_refresh_rejects_when_submit_lock_already_held(monkeypatch):
    """예약 락 획득이 실패하면(동시 요청) 즉시 409를 반환하고 이력 조회조차 하지 않는다."""
    report = SimpleNamespace(id=7, workspace_id="workspace-1", dataset_id="dataset-1")
    db = FakeDb(report)
    redis = FakeRedis()
    client = SimpleNamespace(list_refreshes=AsyncMock())
    monkeypatch.setattr(
        datasets_route.permission_service, "has_permission", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(datasets_route, "acquire_lock", AsyncMock(return_value=None))

    with pytest.raises(ConflictError, match="이미 새로고침이 진행 중입니다"):
        await datasets_route.trigger_refresh(
            "dataset-1",
            db,
            redis,
            client,
            {"user_id": 1, "emp_no": "1001", "roles": ["General_User"]},
        )

    client.list_refreshes.assert_not_awaited()


@pytest.mark.asyncio
async def test_trigger_uses_enhanced_body_and_stores_request_id(monkeypatch):
    refresh_module = importlib.import_module("app.workers.tasks.refresh_trigger")
    redis = FakeRedis()
    posted: dict = {}

    class FakeTokenService:
        def __init__(self, **_kwargs) -> None:
            pass

        async def get_token(self) -> str:
            return "access-token"

    class FakeResponse:
        status_code = 202
        headers = {"x-ms-request-id": "refresh-456"}

    class FakeHttpClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, *, headers, json):
            posted.update({"url": url, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(refresh_module.settings, "APP_MODE", "live")
    monkeypatch.setattr(refresh_module.aioredis, "from_url", lambda *_args, **_kwargs: redis)
    monkeypatch.setattr(refresh_module, "TokenService", FakeTokenService)
    monkeypatch.setattr(refresh_module.httpx, "AsyncClient", lambda **_kwargs: FakeHttpClient())
    monkeypatch.setattr(refresh_module, "acquire_lock", AsyncMock(return_value="lock-token"))
    release_lock = AsyncMock()
    monkeypatch.setattr(refresh_module, "release_lock", release_lock)

    result = await refresh_module._trigger("workspace-1", "dataset-1")

    # Full은 원본 데이터를 다시 처리한다는 점에서 기존 수동 새로고침(빈 본문 standard
    # refresh)과 의미가 같다. Automatic은 준비된 파티션을 건너뛸 수 있어 수동 새로고침의
    # "항상 다시 읽는다" 기대와 다르므로 사용하지 않는다.
    assert posted["json"] == {"type": "Full"}
    assert result["request_id"] == "refresh-456"
    assert any(
        args[0] == refresh_module.refresh_id_key("dataset-1")
        and args[1] == "refresh-456"
        and kwargs["ex"] == 24 * 60 * 60
        for args, kwargs in redis.set_calls
    )
    release_lock.assert_awaited_once_with(redis, "refresh", "dataset-1", "lock-token")


@pytest.mark.asyncio
async def test_trigger_reuses_reservation_lock_value_from_api(monkeypatch):
    """API가 넘겨준 lock_value를 그대로 소유권 토큰으로 사용하고, 새로 획득하지 않는다."""
    refresh_module = importlib.import_module("app.workers.tasks.refresh_trigger")
    redis = KeyedFakeRedis(
        {refresh_module.job_lock_key("refresh", "dataset-1"): "reserved-token"}
    )

    class FakeTokenService:
        def __init__(self, **_kwargs) -> None:
            pass

        async def get_token(self) -> str:
            return "access-token"

    class FakeResponse:
        status_code = 202
        headers = {"x-ms-request-id": "refresh-789"}

    class FakeHttpClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, *, headers, json):
            return FakeResponse()

    acquire_lock = AsyncMock()
    release_lock = AsyncMock()
    monkeypatch.setattr(refresh_module.settings, "APP_MODE", "live")
    monkeypatch.setattr(refresh_module.aioredis, "from_url", lambda *_args, **_kwargs: redis)
    monkeypatch.setattr(refresh_module, "TokenService", FakeTokenService)
    monkeypatch.setattr(refresh_module.httpx, "AsyncClient", lambda **_kwargs: FakeHttpClient())
    monkeypatch.setattr(refresh_module, "acquire_lock", acquire_lock)
    monkeypatch.setattr(refresh_module, "release_lock", release_lock)

    result = await refresh_module._trigger(
        "workspace-1", "dataset-1", lock_value="reserved-token"
    )

    assert result["status"] == "triggered"
    acquire_lock.assert_not_awaited()
    release_lock.assert_awaited_once_with(redis, "refresh", "dataset-1", "reserved-token")


@pytest.mark.asyncio
async def test_trigger_skips_post_when_reservation_expired(monkeypatch):
    """워커 실행 전 예약 락이 다른 값으로 교체/만료되면 Power BI POST를 보내지 않는다.

    reservation-expired 판정은 토큰 발급/HTTP 호출보다 먼저 이루어지므로, 이 테스트는
    TokenService/httpx를 아예 건드리지 않는다는 것 자체가 검증 포인트다(둘 다 monkeypatch
    하지 않고, 실수로 호출되면 실제 네트워크 시도로 실패할 것이다).
    """
    refresh_module = importlib.import_module("app.workers.tasks.refresh_trigger")
    # 현재 저장된 값이 우리가 전달받은 lock_value와 다르다 = 이미 만료되고 재획득됨.
    redis = KeyedFakeRedis(
        {refresh_module.job_lock_key("refresh", "dataset-1"): "someone-elses-token"}
    )
    monkeypatch.setattr(refresh_module.settings, "APP_MODE", "live")
    monkeypatch.setattr(refresh_module.aioredis, "from_url", lambda *_args, **_kwargs: redis)

    result = await refresh_module._trigger(
        "workspace-1", "dataset-1", lock_value="stale-token"
    )

    assert result == {"status": "reservation-expired", "dataset_id": "dataset-1"}
