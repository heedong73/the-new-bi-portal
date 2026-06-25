import logging
import structlog

# 로그에서 마스킹할 키 목록
_SECRET_KEYS = frozenset({
    "password", "passwd", "secret", "token", "access_token",
    "refresh_token", "client_secret", "authorization", "login_pwd",
    "AZURE_CLIENT_SECRET", "SESSION_SECRET", "SMTP_PASSWORD",
})


def _mask_secrets(logger, method, event_dict: dict) -> dict:
    """structlog processor: 시크릿 키 값을 *** 로 치환"""
    for key in list(event_dict.keys()):
        if key.lower() in {k.lower() for k in _SECRET_KEYS}:
            event_dict[key] = "***"
    return event_dict


def setup_logging(log_level: str = "INFO") -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            _mask_secrets,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, log_level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = __name__):
    return structlog.get_logger(name)
