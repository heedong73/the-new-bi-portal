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

import random
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.powerbi.client import (
    DatasetDTO,
    PowerBIClient,
    RefreshRunDTO,
    RefreshScheduleDTO,
    ReportDTO,
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
    """

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
        history). Entries are newest-first, like the real API.
        """
        seed_offset = next(
            (i for i, d in enumerate(_DATASETS) if d["dataset_id"] == dataset_id), None
        )
        if seed_offset is None:
            return []
        runs = _build_refreshes_for_dataset(dataset_id, seed_offset * 0x1000)
        # Newest first (Power BI orders refreshes by startTime DESC).
        runs.sort(key=lambda r: r.start_time, reverse=True)
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


# Structural-typing sanity check: MockPowerBIClient must satisfy the Protocol.
_: PowerBIClient = MockPowerBIClient()
