"""Application settings bound from environment variables (Pydantic v2).

Secrets (e.g. ``AZURE_CLIENT_SECRET``) use ``SecretStr`` so they are never
accidentally rendered in logs, ``repr()`` output, or API responses
(Requirement 20.5).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-bound application configuration.

    Values mirror the root ``.env.example``. ``DATABASE_URL`` / ``REDIS_URL``
    default to compose-internal service names so the app boots without a
    hand-written ``.env`` during local development.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # ----- Azure AD (Power BI auth, Live_Mode only) -----
    AZURE_TENANT_ID: str = ""
    AZURE_CLIENT_ID: str = ""
    AZURE_CLIENT_SECRET: SecretStr = SecretStr("")

    # ----- Power BI -----
    POWERBI_WORKSPACE_ID: str = ""
    POWERBI_API_BASE_URL: str = "https://api.powerbi.com/v1.0/myorg"
    # 외부 HTTPS 호출(Power BI / Azure AD)의 TLS 인증서 검증 여부.
    # 기업 네트워크의 TLS 검사(self-signed 체인) 환경에서 연결이 막힐 때 false 로
    # 두면 우회할 수 있다. 보안상 운영에서는 true 권장(또는 회사 CA 신뢰 설정).
    POWERBI_VERIFY_SSL: bool = True

    # ----- Data stores -----
    DATABASE_URL: str = "postgresql+asyncpg://prm:prm@postgres:5432/prm"
    REDIS_URL: str = "redis://redis:6379/0"

    # ----- Application -----
    APP_TIMEZONE: str = "Asia/Seoul"
    APP_MODE: Literal["mock", "live"] = "mock"
    COLLECT_INTERVAL_MINUTES: int = Field(default=5)
    CACHE_TTL_SECONDS: int = Field(default=60)
    CORS_ALLOWED_ORIGINS: str = "http://localhost:5173"

    # ----- Frontend-facing -----
    AUTO_REFRESH_INTERVAL_SEC: int = Field(default=60)

    @property
    def cors_origins(self) -> list[str]:
        """Parse the comma-separated ``CORS_ALLOWED_ORIGINS`` into a list."""
        return [o.strip() for o in self.CORS_ALLOWED_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return a cached ``Settings`` instance (single load per process)."""
    return Settings()
