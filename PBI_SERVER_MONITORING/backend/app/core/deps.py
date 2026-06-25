"""Shared FastAPI dependency providers.

``get_powerbi_client`` is wired here (stage 2.4): it returns a
``MockPowerBIClient`` when ``APP_MODE=mock`` and defers the ``live`` branch to
stage 4. ``get_session`` (DB) and ``get_redis`` (cache/lock) are wired to their
concrete implementations in ``app/db/session.py`` and ``app/db/redis.py``
(stage 3) and re-exported here so route modules depend on a stable import path.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.redis import get_redis_client
from app.db.session import get_session
from app.services.powerbi.client import PowerBIClient
from app.services.powerbi.live_client import LivePowerBIClient
from app.services.powerbi.mock_client import MockPowerBIClient
from app.services.powerbi.token_service import (
    MockTokenService,
    TokenService,
    TokenServiceProtocol,
)

SettingsDep = Annotated[Settings, Depends(get_settings)]


async def get_redis() -> AsyncGenerator[Redis, None]:
    """Provide the shared async Redis client (``app/db/redis.py``).

    Yields the process-wide cached client; the connection pool is shared, so
    the client itself is not closed per-request. Wire as ``Depends(get_redis)``.
    """
    yield get_redis_client()


SessionDep = Annotated[AsyncSession, Depends(get_session)]
RedisDep = Annotated[Redis, Depends(get_redis)]


async def get_token_service(
    settings: SettingsDep, redis: RedisDep
) -> TokenServiceProtocol:
    """Provide a ``TokenService`` selected by ``APP_MODE`` (stage 4.1).

    - ``mock`` -> ``MockTokenService``: returns a dummy token, makes **zero**
      Azure AD calls (Requirement 2.2).
    - ``live`` -> ``TokenService``: Azure AD ``client_credentials`` flow with a
      Redis-backed token cache (Requirement 3.1~3.4, 11.1).

    Returns the abstract ``TokenServiceProtocol`` so callers (the
    ``LivePowerBIClient`` in stage 4.2) never depend on a concrete
    implementation. Wired as ``Depends(get_token_service)``.
    """
    if settings.APP_MODE == "mock":
        return MockTokenService()
    return TokenService(settings=settings, redis=redis)


TokenServiceDep = Annotated[TokenServiceProtocol, Depends(get_token_service)]


async def get_powerbi_client(
    settings: SettingsDep, token_service: TokenServiceDep
) -> PowerBIClient:
    """Provide a ``PowerBIClient`` selected by ``APP_MODE``.

    - ``mock`` -> ``MockPowerBIClient`` (stage 2.4): generated fixtures, no
      external Power BI / Azure AD calls (Requirement 2.2, 2.3).
    - ``live`` -> ``LivePowerBIClient`` (stage 4.2): real ``httpx`` calls,
      consuming the ``TokenService`` from ``get_token_service`` for bearer auth
      and the 401 re-issue/retry path (Requirement 2.4, 3.5).

    Returns the abstract ``PowerBIClient`` Protocol type so callers never
    depend on a concrete implementation. Wired as a FastAPI dependency via
    ``Depends(get_powerbi_client)`` (Requirement 2.4).
    """
    if settings.APP_MODE == "mock":
        return MockPowerBIClient()

    # Live mode: real Power BI REST API calls backed by the TokenService.
    return LivePowerBIClient(settings=settings, token_service=token_service)


PowerBIClientDep = Annotated[PowerBIClient, Depends(get_powerbi_client)]
