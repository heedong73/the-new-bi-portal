"""새로고침 관련 I/O 스키마."""
from __future__ import annotations

from pydantic import BaseModel


class RefreshStatusResponse(BaseModel):
    """레포트 새로고침 상태 응답 (단일 레포트용)."""
    has_history: bool
    status: str | None = None
    last_refresh_local: str | None = None
    next_scheduled_local: str | None = None
    message: str | None = None


class RefreshRunOut(BaseModel):
    """Refresh_Run 응답 (타임테이블/히스토리)."""
    reportId: str | None
    reportName: str
    datasetId: str | None
    datasetName: str
    refreshType: str | None
    status: str
    startTimeUtc: str | None
    endTimeUtc: str | None
    startTimeLocal: str | None
    endTimeLocal: str | None
    durationSeconds: int | None
    requestId: str | None
    errorMessage: str | None


class LongestRun(BaseModel):
    reportName: str
    durationSeconds: int


class SummaryOut(BaseModel):
    total: int
    success: int
    failed: int
    inProgress: int
    averageDurationSeconds: int
    longestRun: LongestRun | None
    lastCompletedAtLocal: str | None


class DatasetOut(BaseModel):
    datasetId: str
    datasetName: str | None


class ScheduleOut(BaseModel):
    datasetId: str
    datasetName: str | None
    days: list[str]
    times: list[str]
    timezone: str | None
    enabled: bool


class CollectNowOut(BaseModel):
    """POST /api/collect-now 응답.

    - enqueued  → taskId 는 Celery task id.
    - already-running → 이미 수집 진행 중(분산 락 점유), taskId 없음.
    """
    status: str  # "enqueued" | "already-running"
    taskId: str | None = None


class CollectStatusOut(BaseModel):
    """GET /api/collect-status 응답 — 현재 workspace 수집 진행 여부(분산 락 점유)."""
    running: bool


class LatestDateOut(BaseModel):
    """GET /api/refresh-latest-date 응답 — 데이터가 있는 가장 최근 일자(APP_TZ).

    화면 최초 진입 시 기본 선택 일자로 사용한다. 이력이 없으면 date=None.
    """
    date: str | None = None  # "YYYY-MM-DD"
