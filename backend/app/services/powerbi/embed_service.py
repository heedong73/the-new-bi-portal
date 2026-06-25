"""Embed_Service — Power BI Embed Token 발급 (App-Owns-Data).

design.md "Power BI Embedded 조회 설계"(R9, D-06) 참조.
master token은 서버에만, Frontend엔 요청 Report 한정 단기 Embed Token만 전달(R9.4, R38).
mock 모드: 외부 호출 없이 더미 임베드 정보 반환.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings
from app.core.errors import PowerBIError
from app.services.powerbi.token_service import TokenServiceProtocol

@dataclass
class EmbedInfo:
    """Frontend에 전달하는 임베드 정보 (master token 미포함)."""
    embed_url: str
    embed_token: str
    report_id: str
    expiry: str | None = None

_GENERATE_TOKEN_TIMEOUT = httpx.Timeout(connect=5.0, read=30.0, write=30.0, pool=30.0)

async def get_embed_info(
    token_service: TokenServiceProtocol,
    workspace_id: str,
    report_id: str,
    dataset_id: str | None,
) -> EmbedInfo:
    """요청 Report에 한정된 Embed Token + 임베드 URL 반환.

    mock 모드: 더미 토큰. live 모드: GenerateToken 호출(accessLevel=View).
    """
    if settings.APP_MODE == "mock":
        return EmbedInfo(
            embed_url=f"https://app.powerbi.com/reportEmbed?reportId={report_id}",
            embed_token="mock-embed-token",
            report_id=report_id,
            expiry=None,
        )

    access_token = await token_service.get_token()
    url = (
        f"{settings.POWERBI_API_BASE_URL}/groups/{workspace_id}"
        f"/reports/{report_id}/GenerateToken"
    )
    body: dict[str, Any] = {"accessLevel": "View"}
    if dataset_id:
        body["datasets"] = [{"id": dataset_id}]

    try:
        async with httpx.AsyncClient(
            timeout=_GENERATE_TOKEN_TIMEOUT, verify=settings.POWERBI_VERIFY_SSL
        ) as client:
            resp = await client.post(
                url, json=body, headers={"Authorization": f"Bearer {access_token}"}
            )
    except httpx.HTTPError as exc:
        raise PowerBIError("Embed Token 발급 중 연결 오류가 발생했습니다.") from exc

    if resp.status_code >= 400:
        raise PowerBIError(f"Embed Token 발급 실패 (HTTP {resp.status_code}).")

    data = resp.json()
    embed_url = (
        f"{settings.POWERBI_API_BASE_URL.rsplit('/v1.0', 1)[0]}".rstrip("/")
    )  # placeholder; 실제 embedUrl은 report 메타에서 취득 가능
    return EmbedInfo(
        embed_url=f"https://app.powerbi.com/reportEmbed?reportId={report_id}&groupId={workspace_id}",
        embed_token=data.get("token", ""),
        report_id=report_id,
        expiry=data.get("expiration"),
    )
