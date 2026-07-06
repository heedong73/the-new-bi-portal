from pydantic import SecretStr
from pydantic_settings import BaseSettings
from typing import Literal


class Settings(BaseSettings):
    # App
    APP_MODE: Literal["mock", "live"] = "mock"
    AUTH_MODE: Literal["hr-db", "local-only", "mock"] = "mock"
    APP_TIMEZONE: str = "Asia/Seoul"
    SESSION_SECRET: str = "change-me"
    # 세션 정책: 마지막 활동 기준 idle(슬라이딩) + 로그인 기준 absolute(상한).
    # 무활동이 idle 을 넘거나 absolute 상한에 도달하면(둘 중 먼저) 만료된다.
    SESSION_IDLE_MINUTES: int = 120       # 마지막 활동 기준 2시간
    SESSION_ABSOLUTE_MINUTES: int = 720   # 로그인 시점 기준 12시간 상한
    # 세션 쿠키 옵션. Secure 는 HTTPS 전용이므로 개발(HTTP)=False, 운영(HTTPS)=.env 에서 True.
    SESSION_COOKIE_SECURE: bool = False
    SESSION_COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "lax"

    # DB
    DATABASE_URL: str = "postgresql+asyncpg://bip_test:bip_test@localhost:5432/bi_portal_test"
    DATABASE_SSL: Literal["require", "disable"] = "disable"
    DATABASE_SCHEMA: str = "bip"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Azure / Power BI
    AZURE_TENANT_ID: str = ""
    AZURE_CLIENT_ID: str = ""
    AZURE_CLIENT_SECRET: SecretStr = SecretStr("")
    CACHE_TTL_SECONDS: int = 60
    POWERBI_WORKSPACE_ID: str = ""
    POWERBI_API_BASE_URL: str = "https://api.powerbi.com/v1.0/myorg"
    POWERBI_VERIFY_SSL: bool = False

    # HR Auth
    HR_PWD_HASH_ROUNDS: int = 3

    # SMTP
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 587
    SMTP_FROM: str = "bip@example.com"
    SMTP_USE_AUTH: bool = False
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_STARTTLS: bool = False

    # Job intervals
    COLLECT_INTERVAL_MINUTES: int = 5
    EXPORT_POLL_INTERVAL_SEC: int = 5
    EXPORT_POLL_TIMEOUT_SEC: int = 600
    MAIL_RETRY_MAX: int = 3

    # Storage
    STORAGE_ROOT_PATH: str = "/data/reportimage"
    STORAGE_BACKEND: Literal["local", "nas", "s3"] = "local"
    SERVE_REPORTIMAGE_STATIC: bool = False
    IMAGE_RETENTION_DAYS: int = 90
    AUDIT_RETENTION_DAYS: int = 365
    UNUSED_REPORT_DAYS: int = 90

    # 서비스 센터 첨부 (R17) — 파일당 최대 크기(MB)
    REQUEST_ATTACHMENT_MAX_MB: int = 10
    # 서비스 센터 알림 메일 (R17 고도화) — 상태 변경/댓글 시 관련자에게 메일 발송
    REQUEST_NOTIFY_ENABLED: bool = True
    # 신규 요청 등록 시 알림 받을 관리자 이메일
    REQUEST_ADMIN_EMAIL: str = "220042@samchully.co.kr"

    # Frontend
    AUTO_REFRESH_INTERVAL_SEC: int = 60
    CORS_ALLOWED_ORIGINS: str = "http://localhost:80,http://localhost:5173"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def cors_origins(self) -> list[str]:
        """CORS_ALLOWED_ORIGINS(콤마 구분)를 리스트로 파싱."""
        return [o.strip() for o in self.CORS_ALLOWED_ORIGINS.split(",") if o.strip()]


settings = Settings()
