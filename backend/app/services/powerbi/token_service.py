"""Token_Service — Azure AD client credentials flow + Redis token cache.

Design reference: "Token_Service" 표, "Redis 키/TTL 규약".

Responsibilities (Requirement 3.1~3.4, 11.1, 20.5):

- Acquire a Power BI access token from Azure AD using the OAuth2
  ``client_credentials`` grant with ``AZURE_TENANT_ID`` / ``AZURE_CLIENT_ID`` /
  ``AZURE_CLIENT_SECRET`` (R3.1).
- Cache the token in Redis under ``prm:powerbi:token:{tenant}:{client}`` with a
  TTL of ``min(expires_in - 60, 3600)`` seconds so concurrent workers share one
  token and re-issue well before expiry (R3.2, 11.1).
- Return the cached token without hitting Azure AD when a valid one exists
  (R3.3).
- On Azure AD failure (4xx/5xx or transport error) raise
  :class:`TokenServiceError` carrying the upstream status and a Korean message,
  and **never** write an invalid token to Redis (R3.4).
- Expose :meth:`invalidate` so ``LivePowerBIClient`` (stage 4.2) can drop the
  cached token on a 401 and force a single re-issue + retry (R3.5).

Two implementations satisfy :class:`TokenServiceProtocol`:

- :class:`TokenService` — the real Azure AD client (Live_Mode).
- :class:`MockTokenService` — returns a dummy token, makes **zero** Azure AD
  calls (Mock_Mode, R2.2).

Security (Requirement 20.5): the client secret is read via
``SecretStr.get_secret_value()`` only when building the POST body. It is never
placed in a log record or an exception message. Structured logs emit only
``url`` / ``status_code`` / ``elapsed_ms``; the masking processor in
``core/logging.py`` redacts secret-bearing keys defensively.
"""

from __future__ import annotations

import time
from typing import Protocol

import httpx

from app.core.config import Settings
from app.core.errors import PowerBIAuthError
from app.core.logging import get_logger

try:  # redis is an optional import shape; keep typing soft for tooling.
    from redis.asyncio import Redis
except Exception:  # pragma: no cover - redis always present at runtime
    Redis = object  # type: ignore[assignment,misc]

_log = get_logger("app.powerbi.token")

# Azure AD OAuth2 v2.0 authority + Power BI ``.default`` scope (R3.1).
_AUTHORITY_TEMPLATE = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
_POWERBI_SCOPE = "https://analysis.windows.net/powerbi/api/.default"

# Redis key prefix for the cached access token (design "Redis 키/TTL 규약").
_TOKEN_KEY_TEMPLATE = "bip:powerbi:token:{tenant}:{client}"

# TTL policy: never cache for longer than this, and always shave 60s off
# ``expires_in`` so callers re-issue before Azure actually expires the token.
_MAX_TTL_SECONDS = 3600
_TTL_SAFETY_MARGIN_SECONDS = 60

# httpx timeouts for the token endpoint (design: connect 5s, read 30s).
_TOKEN_TIMEOUT = httpx.Timeout(connect=5.0, read=30.0, write=30.0, pool=30.0)


class TokenServiceError(PowerBIAuthError):
    """Azure AD token acquisition failed.

    Subclasses :class:`~app.core.errors.PowerBIAuthError` so it flows through
    the global exception handler as an HTTP **502** ``POWERBI_AUTH_ERROR``
    envelope without any extra wiring (design 오류 분류표). The Azure AD HTTP
    status that triggered the failure is preserved on
    :attr:`azure_status_code` (and echoed in non-sensitive ``details``) for
    diagnostics and for the caller's 401 re-issue decision.

    The ``message`` is a user-facing Korean string and MUST NOT contain the
    client secret or any other credential (Requirement 20.5).
    """

    def __init__(self, status_code: int, message: str) -> None:
        self.azure_status_code = status_code
        super().__init__(message, details={"azureStatusCode": status_code})


class TokenServiceProtocol(Protocol):
    """Abstraction over Power BI access-token acquisition.

    Implemented by :class:`TokenService` (live) and :class:`MockTokenService`
    (mock). Selected by ``APP_MODE`` in ``app.core.deps.get_token_service``.
    """

    async def get_token(self) -> str:
        """Return a valid Power BI access token (cached or freshly issued)."""
        ...

    async def invalidate(self) -> None:
        """Drop the cached token so the next ``get_token`` re-issues."""
        ...


class TokenService:
    """Live Azure AD client-credentials token provider with Redis caching.

    Args:
        settings: bound application settings (tenant/client/secret).
        redis: shared async Redis client (``decode_responses=True``).
        http_client: optional ``httpx.AsyncClient`` to reuse. When ``None`` a
            short-lived client is created per Azure AD request (and closed
            immediately), which keeps the service self-contained for both the
            API process and Celery workers.
    """

    def __init__(
        self,
        settings: Settings,
        redis: "Redis",
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._settings = settings
        self._redis = redis
        self._http_client = http_client
        self._token_url = _AUTHORITY_TEMPLATE.format(tenant=settings.AZURE_TENANT_ID)
        self._cache_key = _TOKEN_KEY_TEMPLATE.format(
            tenant=settings.AZURE_TENANT_ID, client=settings.AZURE_CLIENT_ID
        )

    async def get_token(self) -> str:
        """Return a valid access token, using the Redis cache when possible.

        Returns the cached token without contacting Azure AD when one is
        present (R3.3). Otherwise issues a fresh token via the
        ``client_credentials`` grant, caches it with the TTL policy, and
        returns it (R3.1, R3.2). On any Azure AD / transport failure raises
        :class:`TokenServiceError` and writes nothing to the cache (R3.4).
        """
        cached = await self._redis.get(self._cache_key)
        if cached:
            return cached

        access_token, expires_in = await self._request_token()

        ttl = self._compute_ttl(expires_in)
        if ttl > 0:
            # SET key value EX ttl — only valid tokens reach this point (R3.4).
            await self._redis.set(self._cache_key, access_token, ex=ttl)

        return access_token

    async def invalidate(self) -> None:
        """Delete the cached token (called on HTTP 401, R3.5).

        Idempotent: a missing key is a no-op.
        """
        await self._redis.delete(self._cache_key)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    @staticmethod
    def _compute_ttl(expires_in: int) -> int:
        """Apply the ``min(expires_in - 60, 3600)`` TTL policy (R3.2).

        Clamped to ``>= 0``; a non-positive result means the token is too
        short-lived to safely cache, so the caller skips the Redis write and
        simply returns the freshly issued token.
        """
        return max(0, min(expires_in - _TTL_SAFETY_MARGIN_SECONDS, _MAX_TTL_SECONDS))

    async def _request_token(self) -> tuple[str, int]:
        """POST the ``client_credentials`` grant and parse the token response.

        Returns ``(access_token, expires_in)``. Raises :class:`TokenServiceError`
        on 4xx/5xx, transport errors, or a malformed success body. The client
        secret is read here (and only here) via ``get_secret_value()`` and is
        never logged or placed in an exception message (R20.5).
        """
        body = {
            "grant_type": "client_credentials",
            "client_id": self._settings.AZURE_CLIENT_ID,
            "client_secret": self._settings.AZURE_CLIENT_SECRET.get_secret_value(),
            "scope": _POWERBI_SCOPE,
        }

        started = time.perf_counter()
        try:
            response = await self._post(body)
        except httpx.HTTPError as exc:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
            # Network/transport failure — never reached Azure AD with a status.
            _log.warning(
                "token_request_transport_error",
                url=self._token_url,
                elapsed_ms=elapsed_ms,
                error=type(exc).__name__,
            )
            raise TokenServiceError(
                status_code=503,
                message="Azure AD 토큰 엔드포인트에 연결할 수 없습니다.",
            ) from exc

        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        _log.info(
            "token_request",
            url=self._token_url,
            status_code=response.status_code,
            elapsed_ms=elapsed_ms,
        )

        if response.status_code >= 400:
            # Do NOT cache; surface the upstream status (R3.4).
            raise TokenServiceError(
                status_code=response.status_code,
                message=self._failure_message(response),
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise TokenServiceError(
                status_code=response.status_code,
                message="Azure AD 토큰 응답을 해석할 수 없습니다.",
            ) from exc

        access_token = payload.get("access_token")
        expires_in = payload.get("expires_in")
        if not access_token or not isinstance(expires_in, int):
            raise TokenServiceError(
                status_code=response.status_code,
                message="Azure AD 토큰 응답에 access_token 또는 expires_in이 없습니다.",
            )

        return access_token, expires_in

    async def _post(self, body: dict[str, str]) -> httpx.Response:
        """Issue the token POST, reusing the injected client when provided."""
        if self._http_client is not None:
            return await self._http_client.post(
                self._token_url, data=body, timeout=_TOKEN_TIMEOUT
            )
        async with httpx.AsyncClient(
            timeout=_TOKEN_TIMEOUT, verify=self._settings.POWERBI_VERIFY_SSL
        ) as client:
            return await client.post(self._token_url, data=body)

    @staticmethod
    def _failure_message(response: httpx.Response) -> str:
        """Build a safe Korean failure message from an Azure AD error response.

        Azure AD returns ``{"error": ..., "error_description": ...}`` on
        failure; those fields describe the auth problem and never echo the
        client secret, so including a trimmed ``error`` code is safe. Falls
        back to the HTTP status when the body is not parseable.
        """
        try:
            payload = response.json()
            error = payload.get("error")
            if error:
                return f"Azure AD 토큰 발급 실패 (HTTP {response.status_code}, {error})."
        except ValueError:
            pass
        return f"Azure AD 토큰 발급 실패 (HTTP {response.status_code})."


class MockTokenService:
    """Mock token provider — zero Azure AD calls (Mock_Mode, R2.2).

    Returns a fixed dummy token and treats :meth:`invalidate` as a no-op. Used
    when ``APP_MODE=mock`` so the system never needs real Azure credentials.
    """

    _DUMMY_TOKEN = "mock-powerbi-access-token"

    async def get_token(self) -> str:
        """Return a static dummy token without any external call."""
        return self._DUMMY_TOKEN

    async def invalidate(self) -> None:
        """No-op: there is no cached token to invalidate in mock mode."""
        return None


# Structural-typing sanity check: both implementations satisfy the Protocol.
_mock_check: TokenServiceProtocol = MockTokenService()
