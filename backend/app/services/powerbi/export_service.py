"""Export Service — Power BI Export to File API 호출 래퍼.

design.md "직접 Export 설계"(R9.6, R9.7, D-10) 참조.

Power BI Export to File 흐름:
  1. POST .../ExportTo        → {id, status, percentComplete}
  2. GET  .../exports/{id}    → 폴링 (Running → Succeeded/Failed)
  3. GET  .../exports/{id}/file → 바이너리 다운로드

mock 모드: 외부 호출 없이 최소 PNG 바이트(1×1 투명 픽셀) 반환.
live 모드: httpx + Bearer token, timeout = connect 5s / read 60s.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings
from app.core.errors import PowerBIError
from app.core.logging import get_logger

logger = get_logger(__name__)

# ── 지원 포맷 ──────────────────────────────────────────────────────────────
EXPORT_FORMATS: dict[str, dict[str, str]] = {
    "PDF": {"mime": "application/pdf", "ext": ".pdf"},
    "PNG": {"mime": "image/png", "ext": ".png"},
    "PPTX": {
        "mime": (
            "application/vnd.openxmlformats-officedocument"
            ".presentationml.presentation"
        ),
        "ext": ".pptx",
    },
}

# mock 모드에서 반환할 1×1 투명 PNG (최소 바이트)
_MOCK_PNG_BYTES: bytes = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)

_EXPORT_TIMEOUT = httpx.Timeout(connect=5.0, read=60.0, write=30.0, pool=30.0)


@dataclass
class ExportStartResult:
    """ExportTo API 응답에서 필요한 필드."""

    export_id: str
    status: str  # "Running" | "Succeeded" | "Failed"
    percent_complete: int = 0


@dataclass
class ExportStatusResult:
    """exports/{id} 폴링 응답."""

    export_id: str
    status: str
    percent_complete: int
    resource_location: str | None = None


@dataclass
class ExportFileResult:
    """다운로드한 파일 바이트 + Content-Type."""

    data: bytes
    content_type: str
    file_name: str


# ── mock 헬퍼 ──────────────────────────────────────────────────────────────

def _mock_start(report_name: str, fmt: str) -> ExportStartResult:
    """mock 모드: 즉시 Succeeded 반환 (외부 호출 없음)."""
    mock_id = f"mock-export-{abs(hash(report_name + fmt)) % 1_000_000:06d}"
    logger.info("export_mock_start", export_id=mock_id, format=fmt)
    return ExportStartResult(export_id=mock_id, status="Succeeded", percent_complete=100)


def _mock_file(report_name: str, fmt: str) -> ExportFileResult:
    """mock 모드: 포맷별 최소 파일 반환."""
    info = EXPORT_FORMATS.get(fmt.upper(), EXPORT_FORMATS["PDF"])
    data = _MOCK_PNG_BYTES if fmt.upper() == "PNG" else b"%PDF-1.4 mock\n%%EOF\n"
    return ExportFileResult(
        data=data,
        content_type=info["mime"],
        file_name=f"{report_name}{info['ext']}",
    )


# ── live 구현 ──────────────────────────────────────────────────────────────

async def start_export(
    access_token: str,
    workspace_id: str,
    report_id: str,
    export_format: str,
) -> ExportStartResult:
    """Power BI ExportTo API 호출 → export_id + 초기 status 반환.

    mock 모드는 즉시 Succeeded를 반환하며 외부 호출을 하지 않는다.
    """
    fmt = export_format.upper()
    if fmt not in EXPORT_FORMATS:
        raise ValueError(f"지원하지 않는 export 포맷입니다: {export_format}")

    if settings.APP_MODE == "mock":
        return _mock_start(report_id, fmt)

    url = (
        f"{settings.POWERBI_API_BASE_URL}/groups/{workspace_id}"
        f"/reports/{report_id}/ExportTo"
    )
    body: dict[str, Any] = {"format": fmt}

    try:
        async with httpx.AsyncClient(
            timeout=_EXPORT_TIMEOUT, verify=settings.POWERBI_VERIFY_SSL
        ) as client:
            resp = await client.post(
                url,
                json=body,
                headers={"Authorization": f"Bearer {access_token}"},
            )
    except httpx.HTTPError as exc:
        raise PowerBIError("Export 요청 중 연결 오류가 발생했습니다.") from exc

    if resp.status_code not in (200, 202):
        raise PowerBIError(f"Export 시작 실패 (HTTP {resp.status_code}).")

    data = resp.json()
    logger.info(
        "export_started",
        workspace_id=workspace_id,
        report_id=report_id,
        export_id=data.get("id"),
        status=data.get("status"),
    )
    return ExportStartResult(
        export_id=str(data["id"]),
        status=str(data.get("status", "Running")),
        percent_complete=int(data.get("percentComplete", 0)),
    )


async def get_export_status(
    access_token: str,
    workspace_id: str,
    report_id: str,
    export_id: str,
) -> ExportStatusResult:
    """exports/{exportId} 엔드포인트에서 현재 상태를 조회한다.

    mock 모드는 즉시 Succeeded를 반환한다.
    """
    if settings.APP_MODE == "mock":
        return ExportStatusResult(
            export_id=export_id,
            status="Succeeded",
            percent_complete=100,
        )

    url = (
        f"{settings.POWERBI_API_BASE_URL}/groups/{workspace_id}"
        f"/reports/{report_id}/exports/{export_id}"
    )
    try:
        async with httpx.AsyncClient(
            timeout=_EXPORT_TIMEOUT, verify=settings.POWERBI_VERIFY_SSL
        ) as client:
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
    except httpx.HTTPError as exc:
        raise PowerBIError("Export 상태 조회 중 연결 오류가 발생했습니다.") from exc

    if resp.status_code >= 400:
        raise PowerBIError(f"Export 상태 조회 실패 (HTTP {resp.status_code}).")

    data = resp.json()
    return ExportStatusResult(
        export_id=export_id,
        status=str(data.get("status", "Running")),
        percent_complete=int(data.get("percentComplete", 0)),
        resource_location=data.get("resourceLocation"),
    )


async def download_export_file(
    access_token: str,
    workspace_id: str,
    report_id: str,
    export_id: str,
    report_name: str,
    export_format: str,
) -> ExportFileResult:
    """exports/{exportId}/file 에서 바이너리를 다운로드한다.

    mock 모드는 최소 파일 데이터를 반환한다.
    """
    fmt = export_format.upper()
    if settings.APP_MODE == "mock":
        return _mock_file(report_name, fmt)

    url = (
        f"{settings.POWERBI_API_BASE_URL}/groups/{workspace_id}"
        f"/reports/{report_id}/exports/{export_id}/file"
    )
    try:
        async with httpx.AsyncClient(
            timeout=_EXPORT_TIMEOUT, verify=settings.POWERBI_VERIFY_SSL
        ) as client:
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
    except httpx.HTTPError as exc:
        raise PowerBIError("Export 파일 다운로드 중 연결 오류가 발생했습니다.") from exc

    if resp.status_code >= 400:
        raise PowerBIError(f"Export 파일 다운로드 실패 (HTTP {resp.status_code}).")

    info = EXPORT_FORMATS.get(fmt, EXPORT_FORMATS["PDF"])
    content_type = resp.headers.get("Content-Type", info["mime"])
    file_name = f"{report_name}{info['ext']}"

    logger.info(
        "export_downloaded",
        export_id=export_id,
        size=len(resp.content),
        content_type=content_type,
    )
    return ExportFileResult(
        data=resp.content,
        content_type=content_type,
        file_name=file_name,
    )


async def poll_until_done(
    access_token: str,
    workspace_id: str,
    report_id: str,
    export_id: str,
    poll_interval_sec: int,
    timeout_sec: int,
) -> ExportStatusResult:
    """Succeeded 또는 Failed가 될 때까지 주기적으로 상태를 폴링한다.

    timeout_sec 초 안에 완료되지 않으면 PowerBIError를 발생시킨다.
    mock 모드는 즉시 Succeeded를 반환한다.
    """
    if settings.APP_MODE == "mock":
        return ExportStatusResult(
            export_id=export_id,
            status="Succeeded",
            percent_complete=100,
        )

    elapsed = 0
    while elapsed < timeout_sec:
        result = await get_export_status(
            access_token, workspace_id, report_id, export_id
        )
        logger.info(
            "export_poll",
            export_id=export_id,
            status=result.status,
            percent_complete=result.percent_complete,
            elapsed_sec=elapsed,
        )
        if result.status in ("Succeeded", "Failed"):
            return result
        await asyncio.sleep(poll_interval_sec)
        elapsed += poll_interval_sec

    raise PowerBIError(
        f"Export 폴링 타임아웃 ({timeout_sec}초). export_id={export_id}"
    )
