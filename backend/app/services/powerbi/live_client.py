"""LivePowerBIClient — real Power BI REST API calls (httpx + retry + logging).

Design reference: "PowerBIClient Protocol(Live 정책)", "Redis 키/TTL 규약".

This is the ``APP_MODE=live`` implementation of the ``PowerBIClient`` Protocol
(``client.py``). It performs the four read calls against the Power BI REST API
and maps each payload to the **raw** DTOs shared with ``MockPowerBIClient`` so
the modes stay schema-equivalent (Requirement 2.6 / Property 6).

Transport policy (Requirement 3.5, 4.9, 19.2, 20.1, 20.5):

- **Base URL**: ``settings.POWERBI_API_BASE_URL`` (default
  ``https://api.powerbi.com/v1.0/myorg``).
- **Auth**: ``Authorization: Bearer {token}`` from the injected
  ``TokenServiceProtocol``.
- **Timeouts**: connect 5s, read 30s.
- **401**: ``token_service.invalidate()`` then re-issue + retry **once** (R3.5).
  A second 401 raises :class:`PowerBIAuthError` (HTTP 502).
- **403**: raises :class:`PowerBIForbiddenError` (HTTP 502).
- **429**: wait ``max(Retry-After, exponential backoff)`` then retry, up to 3
  times; exhaustion raises :class:`PowerBIRateLimitError` (R4.9).
- **5xx**: exponential backoff retry up to 3 times; exhaustion raises
  :class:`PowerBIUpstreamError`.
- **Structured log** per attempt: ``{method, url, status_code, elapsed_ms,
  retry_count}`` (R20.1). The bearer token / secrets are **never** placed in a
  log event (R20.5); the masking processor in ``core/logging.py`` is a second
  line of defence.

DTOs stay raw: ``status`` keeps the Power BI string, ``start_time``/``end_time``
are tz-aware UTC, and ``raw_json`` preserves each refresh item verbatim
(Requirement 4.10). Normalization happens later in the service layer.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

import httpx
from dateutil.parser import isoparse

from app.core.config import Settings
from app.core.errors import (
    PowerBIAuthError,
    PowerBIForbiddenError,
    PowerBIRateLimitError,
    PowerBIUpstreamError,
)
from app.core.logging import get_logger
from app.services.powerbi.client import (
    DatasetDTO,
    PowerBIClient,
    RefreshRunDTO,
    RefreshScheduleDTO,
    ReportDTO,
)
from app.services.powerbi.token_service import TokenServiceProtocol

_log = get_logger("app.powerbi.live")

# httpx timeouts (design: connect 5s, read 30s). write/pool kept generous.
_TIMEOUT = httpx.Timeout(connect=5.0, read=30.0, write=30.0, pool=30.0)

# Retry budgets.
_MAX_RATE_LIMIT_RETRIES = 3  # 429 (R4.9)
_MAX_SERVER_RETRIES = 3  # 5xx
_MAX_AUTH_RETRIES = 1  # 401 single re-issue + retry (R3.5)

# Exponential backoff schedule in seconds for attempt 0/1/2 -> 2/4/8.
_BACKOFF_SECONDS = (2.0, 4.0, 8.0)


def _backoff_for(attempt: int) -> float:
    """Return the exponential backoff (2/4/8s) for a 0-indexed retry attempt."""
    if attempt < len(_BACKOFF_SECONDS):
        return _BACKOFF_SECONDS[attempt]
    return _BACKOFF_SECONDS[-1]


def _parse_powerbi_datetime(value: Any) -> datetime | None:
    """Parse a Power BI ISO 8601 timestamp into a tz-aware UTC datetime.

    Power BI returns UTC timestamps such as ``2024-01-01T07:00:00.000Z``. The
    trailing ``Z`` and optional fractional seconds are handled by
    ``dateutil.isoparse``. Naive results are assumed UTC; everything is
    normalized to UTC (Requirement 7.1). Returns ``None`` for empty/missing
    values (e.g. ``endTime`` of an in-progress refresh).
    """
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        dt = isoparse(str(value))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_retry_after(response: httpx.Response) -> float | None:
    """Parse the ``Retry-After`` header as integer seconds.

    Per the design we prioritize the integer-seconds form. An HTTP-date or any
    unparseable value yields ``None`` so the caller falls back to the default
    exponential backoff.
    """
    raw = response.headers.get("Retry-After")
    if raw is None:
        return None
    try:
        seconds = float(raw.strip())
    except (TypeError, ValueError):
        return None
    return seconds if seconds >= 0 else None


class LivePowerBIClient:
    """Live ``PowerBIClient`` backed by ``httpx`` against the Power BI REST API.

    Args:
        settings: bound application settings (provides ``POWERBI_API_BASE_URL``).
        token_service: provider of Power BI access tokens; its ``invalidate()``
            is used to force a re-issue on HTTP 401 (R3.5).
        http_client: optional ``httpx.AsyncClient`` to reuse. When ``None`` a
            short-lived client is created per request (and closed immediately),
            keeping the client self-contained for both the API process and
            Celery workers.
    """

    def __init__(
        self,
        settings: Settings,
        token_service: TokenServiceProtocol,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._settings = settings
        self._token_service = token_service
        self._http_client = http_client
        self._base_url = settings.POWERBI_API_BASE_URL.rstrip("/")

    # ------------------------------------------------------------------
    # Public Protocol methods
    # ------------------------------------------------------------------
    async def list_reports(self, workspace_id: str) -> list[ReportDTO]:
        """Return all reports in the workspace (``GET .../groups/{id}/reports``).

        Maps each ``value[]`` item to a raw :class:`ReportDTO`. ``datasetId``
        may be absent for paginated reports, in which case ``dataset_id`` is
        ``None`` (Requirement 4.1, 6.3).
        """
        data = await self._get(f"/groups/{workspace_id}/reports")
        items = data.get("value", []) if data else []
        return [
            ReportDTO(
                report_id=str(item["id"]),
                report_name=str(item.get("name", "")),
                dataset_id=item.get("datasetId"),
            )
            for item in items
        ]

    async def list_datasets(self, workspace_id: str) -> list[DatasetDTO]:
        """Return all datasets in the workspace (``GET .../datasets``).

        Maps each ``value[]`` item to a raw :class:`DatasetDTO` (Requirement 4.2).
        """
        data = await self._get(f"/groups/{workspace_id}/datasets")
        items = data.get("value", []) if data else []
        return [
            DatasetDTO(
                dataset_id=str(item["id"]),
                dataset_name=str(item.get("name", "")),
            )
            for item in items
        ]

    async def list_refreshes(
        self, workspace_id: str, dataset_id: str, top: int = 60
    ) -> list[RefreshRunDTO]:
        """Return the dataset's refresh history (``GET .../refreshes?$top=N``).

        Maps each ``value[]`` item to a raw :class:`RefreshRunDTO`. ``status``
        stays the raw Power BI string; ``startTime``/``endTime`` are parsed to
        tz-aware UTC (``endTime`` is ``None`` for an in-progress refresh that
        omits the field). The original item is preserved in ``raw_json``
        (Requirement 4.3, 4.10).
        """
        data = await self._get(
            f"/groups/{workspace_id}/datasets/{dataset_id}/refreshes",
            params={"$top": top},
            # Datasets that don't support refresh history (DirectQuery / push /
            # non-refreshable) return 415 (or 404); treat as "no history" so one
            # such dataset doesn't abort collection of the rest.
            allow_statuses=(404, 415),
        )
        items = data.get("value", []) if data else []
        runs: list[RefreshRunDTO] = []
        for item in items:
            runs.append(
                RefreshRunDTO(
                    dataset_id=dataset_id,
                    refresh_type=item.get("refreshType"),
                    status=str(item.get("status", "Unknown")),
                    start_time=_parse_powerbi_datetime(item.get("startTime"))
                    or datetime.now(timezone.utc),
                    end_time=_parse_powerbi_datetime(item.get("endTime")),
                    request_id=str(item.get("requestId", "")),
                    service_exception_json=item.get("serviceExceptionJson"),
                    raw_json=dict(item),
                )
            )
        return runs

    async def get_refresh_schedule(
        self, workspace_id: str, dataset_id: str
    ) -> RefreshScheduleDTO:
        """Return the dataset's refresh schedule (``GET .../refreshSchedule``).

        Power BI returns ``{days, times, enabled, localTimeZoneId, ...}``.
        ``timezone`` is taken from ``localTimeZoneId`` (default ``"UTC"``).

        Some datasets (e.g. those without a configured scheduled refresh) return
        **HTTP 404** for this endpoint; that is handled gracefully as a disabled,
        empty schedule rather than an error (Requirement 4.4).
        """
        data = await self._get(
            f"/groups/{workspace_id}/datasets/{dataset_id}/refreshSchedule",
            allow_404=True,
            # Non-refreshable datasets may also return 415 here; treat as no schedule.
            allow_statuses=(415,),
        )
        if not data:
            return RefreshScheduleDTO(
                dataset_id=dataset_id, days=[], times=[], timezone="UTC", enabled=False
            )
        return RefreshScheduleDTO(
            dataset_id=dataset_id,
            days=list(data.get("days", []) or []),
            times=list(data.get("times", []) or []),
            timezone=data.get("localTimeZoneId") or "UTC",
            enabled=bool(data.get("enabled", True)),
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    async def _get(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        allow_404: bool = False,
        allow_statuses: tuple[int, ...] = (),
    ) -> dict[str, Any] | None:
        """Issue an authenticated GET with the full retry/error policy.

        Returns the parsed JSON object on success. When ``allow_404`` is set, an
        HTTP 404 returns ``None`` instead of raising (used by the refresh
        schedule endpoint, R4.4). ``allow_statuses`` lists additional non-error
        statuses that should return ``None`` instead of raising — used to treat
        datasets that do not support refresh history (Power BI returns HTTP 415
        for DirectQuery / push / non-refreshable models) as simply having no
        history rather than failing the whole collection.

        Retry policy (design "Live 정책"):

        - **401**: invalidate the cached token and retry once (R3.5). A repeated
          401 raises :class:`PowerBIAuthError`.
        - **403**: raises :class:`PowerBIForbiddenError`.
        - **429**: sleep ``max(Retry-After, backoff)`` then retry, up to 3 times;
          exhaustion raises :class:`PowerBIRateLimitError` (R4.9).
        - **5xx**: backoff retry up to 3 times; exhaustion raises
          :class:`PowerBIUpstreamError`.

        Every attempt logs ``{method, url, status_code, elapsed_ms,
        retry_count}`` (R20.1) and never logs the bearer token (R20.5).
        """
        url = f"{self._base_url}{path}"
        auth_retries = 0
        rate_retries = 0
        server_retries = 0
        retry_count = 0

        while True:
            token = await self._token_service.get_token()
            headers = {"Authorization": f"Bearer {token}"}

            status_code, elapsed_ms, response, transport_error = await self._send(
                url, headers, params
            )

            # Structured log per attempt — token/secret never included (R20.5).
            _log.info(
                "powerbi_request",
                method="GET",
                url=url,
                status_code=status_code,
                elapsed_ms=elapsed_ms,
                retry_count=retry_count,
            )

            # --- Transport failure (no HTTP status) -> treat like 5xx backoff.
            if transport_error is not None:
                if server_retries < _MAX_SERVER_RETRIES:
                    await asyncio.sleep(_backoff_for(server_retries))
                    server_retries += 1
                    retry_count += 1
                    continue
                raise PowerBIUpstreamError(
                    "Power BI API에 연결할 수 없습니다.",
                    details={"url": url},
                )

            assert response is not None  # for type-checkers; set when no error

            # --- Success ---
            if status_code < 400:
                return self._parse_json(response, url)

            # --- Caller-allowed non-error statuses -> treat as "no data" ---
            # e.g. HTTP 415 for datasets that don't support refresh history
            # (DirectQuery / push / non-refreshable models) so one such dataset
            # does not fail the whole collection.
            if status_code in allow_statuses:
                return None

            # --- 401: invalidate token + single re-issue/retry (R3.5) ---
            if status_code == 401:
                if auth_retries < _MAX_AUTH_RETRIES:
                    await self._token_service.invalidate()
                    auth_retries += 1
                    retry_count += 1
                    continue
                raise PowerBIAuthError(
                    "Power BI 인증에 실패했습니다 (HTTP 401).",
                    details={"url": url},
                )

            # --- 403: forbidden, no retry ---
            if status_code == 403:
                raise PowerBIForbiddenError(
                    "Power BI 리소스에 접근할 권한이 없습니다 (HTTP 403).",
                    details={"url": url},
                )

            # --- 404: optionally graceful (refresh schedule, R4.4) ---
            if status_code == 404 and allow_404:
                return None

            # --- 429: Retry-After + exponential backoff (R4.9) ---
            if status_code == 429:
                if rate_retries < _MAX_RATE_LIMIT_RETRIES:
                    retry_after = _parse_retry_after(response)
                    wait = max(retry_after or 0.0, _backoff_for(rate_retries))
                    await asyncio.sleep(wait)
                    rate_retries += 1
                    retry_count += 1
                    continue
                raise PowerBIRateLimitError(
                    "Power BI API 호출 한도를 초과했습니다 (HTTP 429).",
                    details={"url": url},
                )

            # --- 5xx: exponential backoff retry ---
            if status_code >= 500:
                if server_retries < _MAX_SERVER_RETRIES:
                    await asyncio.sleep(_backoff_for(server_retries))
                    server_retries += 1
                    retry_count += 1
                    continue
                raise PowerBIUpstreamError(
                    f"Power BI API 오류가 발생했습니다 (HTTP {status_code}).",
                    details={"url": url},
                )

            # --- Other 4xx: unexpected, surface as upstream error ---
            raise PowerBIUpstreamError(
                f"Power BI API 호출이 실패했습니다 (HTTP {status_code}).",
                details={"url": url},
            )

    async def _send(
        self,
        url: str,
        headers: dict[str, str],
        params: dict[str, Any] | None,
    ) -> tuple[int, float, httpx.Response | None, Exception | None]:
        """Perform one HTTP GET, returning status/elapsed/response/transport-error.

        Reuses the injected ``httpx.AsyncClient`` when present, otherwise creates
        a short-lived one. Transport errors are captured (not raised) so the
        caller can apply backoff uniformly with 5xx; ``elapsed_ms`` is measured
        with a monotonic clock for accurate logging (R20.1).
        """
        started = asyncio.get_event_loop().time()
        try:
            if self._http_client is not None:
                response = await self._http_client.get(
                    url, headers=headers, params=params, timeout=_TIMEOUT
                )
            else:
                async with httpx.AsyncClient(
                    timeout=_TIMEOUT, verify=self._settings.POWERBI_VERIFY_SSL
                ) as client:
                    response = await client.get(url, headers=headers, params=params)
        except httpx.HTTPError as exc:
            elapsed_ms = round((asyncio.get_event_loop().time() - started) * 1000, 1)
            return 0, elapsed_ms, None, exc

        elapsed_ms = round((asyncio.get_event_loop().time() - started) * 1000, 1)
        return response.status_code, elapsed_ms, response, None

    @staticmethod
    def _parse_json(response: httpx.Response, url: str) -> dict[str, Any]:
        """Parse a success response body as a JSON object.

        A non-object or unparseable success body is an upstream contract
        violation and surfaces as :class:`PowerBIUpstreamError`.
        """
        try:
            payload = response.json()
        except ValueError as exc:
            raise PowerBIUpstreamError(
                "Power BI API 응답을 해석할 수 없습니다.",
                details={"url": url},
            ) from exc
        if not isinstance(payload, dict):
            raise PowerBIUpstreamError(
                "Power BI API 응답 형식이 올바르지 않습니다.",
                details={"url": url},
            )
        return payload


# Structural-typing sanity check: LivePowerBIClient must satisfy the Protocol.
def _protocol_check(client: LivePowerBIClient) -> PowerBIClient:
    return client
