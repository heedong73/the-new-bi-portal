"""MockPowerBIClient — generated fixtures, no external Power BI calls.

Design reference: "런타임 모드(Mock vs Live)", "MockPowerBIClient 픽스처".

Used when ``APP_MODE=mock`` (Requirement 2.2, 2.3). Returns the same raw DTOs
as ``LivePowerBIClient`` so the rest of the system (and the Frontend) cannot
tell the modes apart (Requirement 2.6 / Property 6).

Fixture composition (mirrors ``frontend/src/mocks/fixtures.ts`` semantically):

- 4 datasets, 7 reports.
- 1 shared dataset (``ds-sales-0001``) used by 3 reports (Requirement 6.2).
- 1 paginated report with no ``datasetId`` (Requirement 6.3).
- 30~60 refreshes per dataset with a mixed status distribution
  (Completed / Failed / Unknown[in-progress, no endTime] / Disabled) and mixed
  ``refreshType`` (Scheduled / OnDemand / ViaApi).
- Failed entries carry a sample ``serviceExceptionJson``.
- Times are computed as "current UTC − N minutes" so the UI always looks
  fresh. ``raw_json`` preserves the original Power BI object shape verbatim.

**Why generated (not static JSON files):** the design notes fixtures can live
as JSON, but the times must be relative to *now* on every call so the screen
stays current. A fixed PRNG seed keeps the *distribution* (status mix, counts,
durations) deterministic across calls while the absolute timestamps slide with
wall-clock time. Reports/datasets/schedules use a fixed seed; only timestamps
depend on ``datetime.now``.

DTOs returned here are **raw**: ``status`` is the original Power BI string,
``start_time``/``end_time`` are tz-aware UTC. Normalization, error parsing,
local-time conversion, and the Report↔Dataset join all happen in the service
layer (stage 2.6 / 3.x), not here.
"""

from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from typing import Any

from dateutil.parser import isoparse
from redis.asyncio import Redis

from app.core.errors import PowerBIUpstreamError
from app.services.powerbi.client import (
    DatasetDTO,
    PowerBIClient,
    RefreshRunDTO,
    RefreshScheduleDTO,
    ReportDTO,
    ReportPageDTO,
)

# --- Static catalogue (seed-stable; mirrors the Frontend fixtures) ----------

# Datasets (4) — design requires 3~5.
_DATASETS: list[dict[str, str]] = [
    {"dataset_id": "ds-sales-0001", "dataset_name": "매출 통합 데이터셋"},
    {"dataset_id": "ds-finance-0002", "dataset_name": "재무 마감 데이터셋"},
    {"dataset_id": "ds-ops-0003", "dataset_name": "운영 지표 데이터셋"},
    {"dataset_id": "ds-marketing-0004", "dataset_name": "마케팅 캠페인 데이터셋"},
]

# Reports (7) — design requires 5~10.
#   - ds-sales-0001 is shared by 3 reports (shared-dataset case, R6.2).
#   - the last report is paginated: dataset_id is None (R6.3).
_REPORTS: list[dict[str, str | None]] = [
    {"report_id": "rep-0001", "report_name": "매출 일일 보고", "dataset_id": "ds-sales-0001"},
    {"report_id": "rep-0002", "report_name": "매출 지역별 분석", "dataset_id": "ds-sales-0001"},
    {"report_id": "rep-0003", "report_name": "매출 임원 대시보드", "dataset_id": "ds-sales-0001"},
    {"report_id": "rep-0004", "report_name": "재무 마감 현황", "dataset_id": "ds-finance-0002"},
    {"report_id": "rep-0005", "report_name": "운영 모니터링", "dataset_id": "ds-ops-0003"},
    {"report_id": "rep-0006", "report_name": "마케팅 성과 분석", "dataset_id": "ds-marketing-0004"},
    {"report_id": "rep-0007", "report_name": "월간 정산 명세서(Paginated)", "dataset_id": None},
]

# Raw Power BI refresh types.
_REFRESH_TYPES = ["Scheduled", "OnDemand", "ViaApi"]

# Raw Power BI status distribution (weighted). NOTE: these are the *raw* Power
# BI strings, not the internal enum. "Unknown" without endTime => in-progress;
# "Unknown" with endTime and "Disabled" => unknown (resolved by status_mapper).
_STATUS_WEIGHTS: list[tuple[str, int]] = [
    ("Completed", 70),
    ("Failed", 16),
    ("Unknown", 8),  # in-progress (no endTime)
    ("Disabled", 6),  # unknown
]

# Sample serviceExceptionJson payloads for failed runs (Power BI raw shape).
_FAILED_EXCEPTIONS: list[str] = [
    '{"errorCode": "ModelRefreshFailed_CredentialsNotSpecified", '
    '"errorDescription": "데이터 원본 자격 증명이 지정되지 않았습니다."}',
    '{"errorCode": "DM_GWPipeline_Gateway_DataSourceAccessError", '
    '"errorDescription": "게이트웨이에서 데이터 원본에 접근할 수 없습니다."}',
    '{"errorCode": "Database", '
    '"errorDescription": "Timeout expired. The timeout period elapsed prior to completion."}',
    '{"code": "QueryUserError", '
    '"message": "쿼리 실행 중 메모리 한도를 초과했습니다."}',
    '{"errorCode": "ModelRefresh_ShortMessage_ProcessingError", '
    '"errorDescription": "데이터셋 처리 중 오류가 발생했습니다."}',
]

# Weekday catalogues for schedules.
_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
_ALL_DAYS = [*_WEEKDAYS, "Saturday", "Sunday"]

# Per-dataset schedule variants (cycled by index) — some disabled / weekend.
_SCHEDULE_VARIANTS: list[dict[str, Any]] = [
    {"days": _WEEKDAYS, "times": ["07:00", "13:00"], "enabled": True},
    {"days": _ALL_DAYS, "times": ["06:30"], "enabled": True},
    {"days": _WEEKDAYS, "times": ["08:00", "12:00", "18:00"], "enabled": True},
    {"days": ["Monday", "Thursday"], "times": ["09:00"], "enabled": False},
]

# Base seed for the deterministic distribution (status mix / counts / durations).
_BASE_SEED = 0x9E3779B1

# --- Stateful simulated refresh (trigger/cancel round-trip) ----------------
#
# The generated history above is read-only flavour text. To let the manual
# refresh "trigger -> observe progress -> stop -> Cancelled" flow be exercised
# end-to-end in mock mode (the app's default), a single in-flight refresh per
# dataset is tracked in Redis by ``refresh_trigger``/``cancel_refresh`` calling
# ``register_mock_refresh``/``cancel_refresh`` below. It starts as ``"Unknown"``
# (in-progress) and, unless cancelled first, auto-completes after
# ``_MOCK_REFRESH_RUNNING_SEC`` seconds — long enough for the UI to observe
# "in progress" and enable the stop button, short enough not to block manual
# testing. ``refresh_type`` is always ``"ViaEnhancedApi"`` since only enhanced
# refresh (our trigger path) is cancellable.
_MOCK_REFRESH_RUNNING_SEC = 20
_MOCK_REFRESH_RECORD_TTL_SEC = 24 * 60 * 60  # mirrors the real requestId TTL.
_MOCK_TERMINAL_STATUSES = frozenset({"Completed", "Failed", "Disabled", "Cancelled"})
_MOCK_ENHANCED_REFRESH_TYPE = "ViaEnhancedApi"


def _mock_refresh_key(dataset_id: str) -> str:
    """Redis key holding the single tracked simulated refresh for a dataset."""
    return f"bip:mockrefresh:{dataset_id}"


async def register_mock_refresh(redis: Redis, dataset_id: str, request_id: str) -> None:
    """Persist a fresh in-progress simulated refresh for ``dataset_id``.

    Called by ``refresh_trigger`` (mock branch) right after it mints
    ``request_id`` so ``MockPowerBIClient.list_refreshes``/``cancel_refresh``
    (used by the live-status and cancel routes) observe the same
    "Unknown -> Completed/Cancelled" lifecycle a real enhanced refresh has.
    This lets the stop button be exercised end-to-end without a live Power BI
    capacity. Best-effort: a Redis failure here just means the mock reports
    "no history" on the next read, matching the previous stateless behaviour.
    """
    record = {
        "request_id": request_id,
        "status": "Unknown",
        "start_time": _iso_utc(datetime.now(timezone.utc)),
        "end_time": None,
    }
    try:
        await redis.set(
            _mock_refresh_key(dataset_id), json.dumps(record), ex=_MOCK_REFRESH_RECORD_TTL_SEC
        )
    except Exception:
        pass


async def _load_mock_refresh(redis: Redis | None, dataset_id: str) -> dict[str, Any] | None:
    """Load the tracked simulated refresh record for ``dataset_id``, if any."""
    if redis is None:
        return None
    try:
        raw = await redis.get(_mock_refresh_key(dataset_id))
    except Exception:
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def _mock_refresh_to_dto(record: dict[str, Any], dataset_id: str) -> RefreshRunDTO:
    """Map a tracked simulated-refresh record to a raw :class:`RefreshRunDTO`.

    Auto-completes an ``"Unknown"`` (in-progress) record to ``"Completed"``
    once ``_MOCK_REFRESH_RUNNING_SEC`` has elapsed since ``start_time`` — this
    is computed on read (not written back), so it is deterministic regardless
    of how many times/when it is observed. A record already terminated
    (``Cancelled`` via :meth:`MockPowerBIClient.cancel_refresh``, or a prior
    auto-completion) is returned as-is.
    """
    start_time = isoparse(record["start_time"])
    status = record["status"]
    end_time_raw = record.get("end_time")
    end_time = isoparse(end_time_raw) if end_time_raw else None

    if status == "Unknown" and end_time is None:
        elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
        if elapsed >= _MOCK_REFRESH_RUNNING_SEC:
            status = "Completed"
            end_time = start_time + timedelta(seconds=_MOCK_REFRESH_RUNNING_SEC)

    raw: dict[str, Any] = {
        "requestId": record["request_id"],
        "refreshType": _MOCK_ENHANCED_REFRESH_TYPE,
        "startTime": _iso_utc(start_time),
        "status": status,
    }
    if end_time is not None:
        raw["endTime"] = _iso_utc(end_time)

    return RefreshRunDTO(
        dataset_id=dataset_id,
        refresh_type=_MOCK_ENHANCED_REFRESH_TYPE,
        status=status,
        start_time=start_time,
        end_time=end_time,
        request_id=record["request_id"],
        raw_json=raw,
    )


def _weighted_status(rng: random.Random) -> str:
    """Pick a raw Power BI status from the weighted distribution."""
    total = sum(w for _, w in _STATUS_WEIGHTS)
    r = rng.random() * total
    for status, weight in _STATUS_WEIGHTS:
        if r < weight:
            return status
        r -= weight
    return "Completed"


def _iso_utc(dt: datetime) -> str:
    """Render a UTC datetime as Power BI-style ISO 8601 (``...Z``)."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _build_refreshes_for_dataset(dataset_id: str, seed_offset: int) -> list[RefreshRunDTO]:
    """Generate 30~60 raw refresh entries for a dataset.

    The distribution is deterministic (seeded), but timestamps are relative to
    the current UTC time so the dataset always looks freshly refreshed.
    """
    rng = random.Random(_BASE_SEED + seed_offset)
    now = datetime.now(timezone.utc)
    count = rng.randint(30, 60)
    runs: list[RefreshRunDTO] = []

    # Most recent run starts 0~20 minutes ago; walk backwards from there.
    cursor_start = now - timedelta(minutes=rng.randint(0, 20))

    for i in range(count):
        status = _weighted_status(rng)
        refresh_type = rng.choice(_REFRESH_TYPES)
        duration_seconds = rng.randint(20, 900)  # 20s ~ 15m

        start_time = cursor_start
        in_progress = status == "Unknown"  # Unknown == still running (no endTime)
        end_time = None if in_progress else start_time + timedelta(seconds=duration_seconds)

        service_exception = rng.choice(_FAILED_EXCEPTIONS) if status == "Failed" else None
        request_id = f"req-{dataset_id}-{i:03d}"

        # Power BI raw object shape (preserved verbatim in raw_json, R4.10).
        raw: dict[str, Any] = {
            "requestId": request_id,
            "id": 1_000_000 + i,
            "refreshType": refresh_type,
            "startTime": _iso_utc(start_time),
            "status": status,
        }
        if end_time is not None:
            raw["endTime"] = _iso_utc(end_time)
        if service_exception is not None:
            raw["serviceExceptionJson"] = service_exception

        runs.append(
            RefreshRunDTO(
                dataset_id=dataset_id,
                refresh_type=refresh_type,
                status=status,
                start_time=start_time,
                end_time=end_time,
                request_id=request_id,
                service_exception_json=service_exception,
                raw_json=raw,
            )
        )

        # Move cursor to the next (older) run.
        cursor_start = start_time - timedelta(minutes=rng.randint(25, 70))

    return runs


class MockPowerBIClient:
    """In-memory ``PowerBIClient`` backed by generated fixtures.

    Satisfies the ``PowerBIClient`` Protocol structurally (no inheritance
    needed). All methods ignore ``workspace_id`` for filtering since the mock
    represents a single workspace, but accept it to match the Protocol.

    Args:
        redis: optional Redis client used to look up/mutate the single
            tracked simulated refresh registered by
            :func:`register_mock_refresh` (manual trigger/cancel round-trip,
            R13/R37). When omitted (e.g. the module-level Protocol sanity
            check below), ``list_refreshes``/``cancel_refresh`` fall back to
            the previous stateless behaviour (fixtures only / no-op cancel).
    """

    def __init__(self, redis: Redis | None = None) -> None:
        self._redis = redis

    async def list_reports(self, workspace_id: str) -> list[ReportDTO]:
        """Return all mock reports (includes the paginated, dataset-less one)."""
        return [
            ReportDTO(
                report_id=str(r["report_id"]),
                report_name=str(r["report_name"]),
                dataset_id=r["dataset_id"],  # type: ignore[arg-type]
            )
            for r in _REPORTS
        ]

    async def list_datasets(self, workspace_id: str) -> list[DatasetDTO]:
        """Return all mock datasets."""
        return [
            DatasetDTO(dataset_id=d["dataset_id"], dataset_name=d["dataset_name"])
            for d in _DATASETS
        ]

    async def list_refreshes(
        self, workspace_id: str, dataset_id: str, top: int = 60
    ) -> list[RefreshRunDTO]:
        """Return up to ``top`` raw refresh entries for ``dataset_id``.

        Unknown dataset ids yield an empty list (mirrors Power BI returning no
        history). Entries are newest-first, like the real API. If a manual
        refresh was triggered for this dataset (:func:`register_mock_refresh`),
        its current simulated state is prepended so the live-status/cancel
        routes observe a real in-progress -> terminal transition instead of
        the static fixture noise (Requirement R13/R37).
        """
        seed_offset = next(
            (i for i, d in enumerate(_DATASETS) if d["dataset_id"] == dataset_id), None
        )
        if seed_offset is None:
            return []
        runs = _build_refreshes_for_dataset(dataset_id, seed_offset * 0x1000)
        # Newest first (Power BI orders refreshes by startTime DESC).
        runs.sort(key=lambda r: r.start_time, reverse=True)

        record = await _load_mock_refresh(self._redis, dataset_id)
        if record is not None:
            tracked = _mock_refresh_to_dto(record, dataset_id)
            runs = [tracked, *(r for r in runs if r.request_id != tracked.request_id)]

        return runs[:top]

    async def get_refresh_schedule(
        self, workspace_id: str, dataset_id: str
    ) -> RefreshScheduleDTO:
        """Return the mock refresh schedule for ``dataset_id``.

        Unknown dataset ids get a disabled, empty schedule.
        """
        idx = next(
            (i for i, d in enumerate(_DATASETS) if d["dataset_id"] == dataset_id), None
        )
        if idx is None:
            return RefreshScheduleDTO(
                dataset_id=dataset_id, days=[], times=[], timezone="Asia/Seoul", enabled=False
            )
        variant = _SCHEDULE_VARIANTS[idx % len(_SCHEDULE_VARIANTS)]
        return RefreshScheduleDTO(
            dataset_id=dataset_id,
            days=list(variant["days"]),
            times=list(variant["times"]),
            timezone="Asia/Seoul",
            enabled=bool(variant["enabled"]),
        )

    async def get_report_pages(
        self, workspace_id: str, report_id: str
    ) -> list[ReportPageDTO]:
        """Return mock report pages. 페이지명 선택 UI 개발/시연용 샘플 페이지."""
        sample = [
            ("ReportSection1", "개요"),
            ("ReportSection2", "월별 추이"),
            ("ReportSection3", "지역별 분석"),
            ("ReportSection4", "상세 데이터"),
        ]
        return [
            ReportPageDTO(name=name, display_name=display, order=i)
            for i, (name, display) in enumerate(sample)
        ]

    async def cancel_refresh(
        self, workspace_id: str, dataset_id: str, refresh_id: str
    ) -> None:
        """Mock 취소: 추적 중인 시뮬레이션 refresh를 실제로 Cancelled 상태로 전이한다.

        ``refresh_id``가 현재 추적 중인 레코드와 일치하지 않거나 이미 종료된 경우,
        실제 Power BI DELETE API가 반환하는 400(MethodNotAllowed)을 재현해 라우트가
        표준 409 처리로 매핑하도록 한다. 이렇게 해야 mock 모드에서도 "이미 끝난
        작업/표준 refresh 취소 시도" 오류 경로를 그대로 검증할 수 있다.
        """
        record = await _load_mock_refresh(self._redis, dataset_id)
        if record is None or record["request_id"] != refresh_id:
            raise PowerBIUpstreamError(
                "Power BI 새로고침 취소가 실패했습니다 (HTTP 400).",
                details={"http_status": 400},
            )
        dto = _mock_refresh_to_dto(record, dataset_id)
        if dto.status in _MOCK_TERMINAL_STATUSES:
            raise PowerBIUpstreamError(
                "Power BI 새로고침 취소가 실패했습니다 (HTTP 400).",
                details={"http_status": 400},
            )
        if self._redis is not None:
            record["status"] = "Cancelled"
            record["end_time"] = _iso_utc(datetime.now(timezone.utc))
            try:
                await self._redis.set(
                    _mock_refresh_key(dataset_id),
                    json.dumps(record),
                    ex=_MOCK_REFRESH_RECORD_TTL_SEC,
                )
            except Exception:
                pass


# Structural-typing sanity check: MockPowerBIClient must satisfy the Protocol.
_: PowerBIClient = MockPowerBIClient()
