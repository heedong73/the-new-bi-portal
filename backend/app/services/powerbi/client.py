"""PowerBIClient Protocol and raw Power BI DTOs.

Design reference: "런타임 모드(Mock vs Live)" and "PowerBIClient Protocol".

This module defines the **abstraction boundary** between the rest of the
application and the Power BI REST API. Two implementations satisfy the
``PowerBIClient`` Protocol:

- ``MockPowerBIClient`` (``mock_client.py``, stage 2.4) — generated fixtures,
  no external calls.
- ``LivePowerBIClient`` (``live_client.py``, stage 4) — real ``httpx`` calls.

The factory ``app.core.deps.get_powerbi_client`` selects one based on
``APP_MODE`` so that callers (routes, collector) never depend on a concrete
implementation (Requirement 2.1, 2.2, 2.4).

DTOs intentionally stay **close to the Power BI API payload (raw)**:

- ``status`` keeps the original Power BI string (``"Completed"`` / ``"Failed"``
  / ``"Unknown"`` / ``"Disabled"``), NOT the internal normalized enum.
- ``start_time`` / ``end_time`` are tz-aware UTC datetimes (Power BI returns UTC).
- ``service_exception_json`` is the raw ``serviceExceptionJson`` string.
- ``raw_json`` preserves the original Power BI object (Requirement 4.10).

Normalization (``status_mapper.map_status``), error parsing
(``error_parser.parse_service_exception``), local-time conversion, and the
Report ↔ Dataset join are all performed later in the service layer (stage 2.6 /
3.x), NOT here. This keeps the client a thin, faithful transport of raw data.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field


class ReportDTO(BaseModel):
    """Raw Power BI report (``GET /groups/{groupId}/reports`` item).

    ``dataset_id`` is ``None`` for paginated reports, which have no associated
    semantic model (Requirement 6.3).
    """

    report_id: str
    report_name: str
    dataset_id: str | None = None


class DatasetDTO(BaseModel):
    """Raw Power BI dataset (``GET /groups/{groupId}/datasets`` item)."""

    dataset_id: str
    dataset_name: str


class ReportPageDTO(BaseModel):
    """Raw Power BI report page (``GET .../reports/{id}/pages`` item).

    ``name`` is the internal section name (e.g. ``ReportSection1``) used by the
    Export to File API. ``display_name`` is the human-facing tab title.
    """

    name: str
    display_name: str
    order: int | None = None


class RefreshRunDTO(BaseModel):
    """Raw Power BI refresh history entry.

    Mirrors a single item from
    ``GET /groups/{groupId}/datasets/{datasetId}/refreshes``. All fields stay
    in their raw Power BI form; normalization happens in the service layer.

    - ``status``: raw Power BI status string (``"Completed"`` / ``"Failed"`` /
      ``"Unknown"`` / ``"Disabled"`` / ...). Mapped to the internal enum by
      ``status_mapper.map_status`` later.
    - ``start_time`` / ``end_time``: tz-aware UTC datetimes. ``end_time`` is
      ``None`` while a refresh is still running (Power BI omits ``endTime``).
    - ``service_exception_json``: raw ``serviceExceptionJson`` (failures only).
    - ``raw_json``: the original Power BI object, preserved verbatim
      (Requirement 4.10).
    """

    dataset_id: str
    refresh_type: str | None = None
    status: str
    start_time: datetime
    end_time: datetime | None = None
    request_id: str
    service_exception_json: str | None = None
    raw_json: dict[str, Any] = Field(default_factory=dict)


class RefreshScheduleDTO(BaseModel):
    """Raw Power BI refresh schedule.

    Mirrors ``GET /groups/{groupId}/datasets/{datasetId}/refreshSchedule``.
    Power BI returns ``days`` (e.g. ``["Monday", ...]``), ``times`` (e.g.
    ``["07:00", "13:00"]``), ``localTimeZoneId`` (mapped here to ``timezone``),
    and ``enabled``.
    """

    dataset_id: str
    days: list[str] = Field(default_factory=list)
    times: list[str] = Field(default_factory=list)
    timezone: str = "UTC"
    enabled: bool = True


@runtime_checkable
class PowerBIClient(Protocol):
    """Abstraction over the Power BI REST API.

    Both ``MockPowerBIClient`` and ``LivePowerBIClient`` implement this
    Protocol. All methods are async and return raw DTOs (see module docstring).
    """

    async def list_reports(self, workspace_id: str) -> list[ReportDTO]:
        """Return all reports in the workspace (``GET .../reports``)."""
        ...

    async def list_datasets(self, workspace_id: str) -> list[DatasetDTO]:
        """Return all datasets in the workspace (``GET .../datasets``)."""
        ...

    async def list_refreshes(
        self, workspace_id: str, dataset_id: str, top: int = 60
    ) -> list[RefreshRunDTO]:
        """Return the dataset's refresh history (``GET .../refreshes?$top=N``)."""
        ...

    async def get_refresh_schedule(
        self, workspace_id: str, dataset_id: str
    ) -> RefreshScheduleDTO:
        """Return the dataset's refresh schedule (``GET .../refreshSchedule``)."""
        ...

    async def get_report_pages(
        self, workspace_id: str, report_id: str
    ) -> list[ReportPageDTO]:
        """Return the report's pages (``GET .../reports/{id}/pages``)."""
        ...
